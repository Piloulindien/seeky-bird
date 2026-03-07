// src/server/replaySim.ts
/**
 * Deterministic replay simulation for SeekyScene (server-side)
 * Goal: recompute score from (seed, taps[]) instead of trusting client score.
 */

export type ReplayResult =
  | { ok: true; score: number; diedAtMs: number }
  | { ok: false; error: string };

type Pipe = {
  x: number;
  y: number;
  w: number;
  h: number;
  isTop: boolean;
  scored: boolean;
};

function lcgNext(seed: number): number {
  return (Math.imul(seed >>> 0, 1664525) + 1013904223) >>> 0;
}

function rnd01(seedRef: { v: number }): number {
  seedRef.v = lcgNext(seedRef.v);
  return seedRef.v / 0x100000000;
}

function rndInt(seedRef: { v: number }, min: number, max: number): number {
  const a = Math.min(min, max);
  const b = Math.max(min, max);
  return a + Math.floor(rnd01(seedRef) * (b - a + 1));
}

export function simulateSeekyRun(args: {
  seed: number;
  tapsMs: number[];
}): ReplayResult {
  // --- Constants (must match scene.ts) ---
  const WIDTH = 390;
  const HEIGHT = 720;

  const groundY = HEIGHT - 90;
  const birdX = WIDTH * 0.35;
  const birdStartY = HEIGHT * 0.5;

  const gravity = 900;
  const flapStrength = -300;

  const spawnEveryMs = 1350;
  const baseSpeed = 260;
  const baseGap = 170;
  const margin = 80;
  const pipeW = 70;

  const coyoteMs = 80;
  const birdPad = 14;

  const fixedStepMs = 1000 / 60;
  const maxSubSteps = 5;

  // --- HARD LIMITS (anti-cheat / anti-DoS) ---
  const maxSimMs = 120_000; // 2 min cap
  const maxTaps = 2000; // generous upper bound

  // --- Input sanitize ---
  const seed0 = Math.floor(Number(args.seed) || 0) >>> 0;
  if (!seed0) return { ok: false, error: "BAD_SEED" };

  const taps = Array.isArray(args.tapsMs)
    ? args.tapsMs
        .map((n) => Math.max(0, Math.floor(Number(n))))
        .filter((n) => Number.isFinite(n))
    : [];

  if (taps.length === 0) return { ok: false, error: "NO_TAPS" };
  if (taps.length > maxTaps) return { ok: false, error: "TOO_MANY_TAPS" };

  if (taps[0] !== 0) return { ok: false, error: "FIRST_TAP_NOT_ZERO" };

  for (let i = 1; i < taps.length; i++) {
    if (taps[i] < taps[i - 1]) return { ok: false, error: "TAPS_NOT_SORTED" };
  }

  const seedRef = { v: seed0 };

  let tMs = 0;
  let started = false;
  let isDead = false;

  let birdY = birdStartY;
  let velocityY = 0;

  let lastTapAt = 0;
  let spawnTimer = 0;

  let score = 0;
  const pipes: Pipe[] = [];

  let tapIdx = 0;

  const spawnPipePair = () => {
    const gap = baseGap;

    const minY = Math.floor(margin + gap / 2);
    const maxY = Math.floor(HEIGHT - margin - gap / 2);

    const gapY = rndInt(seedRef, minY, maxY);

    const topH = gapY - gap / 2;
    const bottomY = gapY + gap / 2;
    const bottomH = HEIGHT - bottomY;

    const x = WIDTH + 80;

    pipes.push({
      x,
      y: topH / 2,
      w: pipeW,
      h: topH,
      isTop: true,
      scored: false,
    });

    pipes.push({
      x,
      y: bottomY + bottomH / 2,
      w: pipeW,
      h: bottomH,
      isTop: false,
      scored: false,
    });
  };

  const applyTap = (tapTime: number) => {
    if (!started) {
      started = true;
      spawnTimer = 0;
    }
    lastTapAt = tapTime;
    velocityY = flapStrength;
  };

  const stepFixed = (stepMs: number) => {
    const dt = stepMs / 1000;

    spawnTimer += stepMs;
    if (spawnTimer >= spawnEveryMs) {
      spawnTimer = 0;
      spawnPipePair();
    }

    velocityY += gravity * dt;
    birdY += velocityY * dt;

    if (birdY < 0 || birdY > groundY) {
      const sinceTap = tMs - lastTapAt;
      if (sinceTap > coyoteMs) {
        isDead = true;
        return;
      }
    }

    for (const p of pipes) p.x -= baseSpeed * dt;

    for (const p of pipes) {
      const dx = Math.abs(p.x - birdX);
      const dy = Math.abs(p.y - birdY);

      if (dx < p.w / 2 + birdPad && dy < p.h / 2 + birdPad) {
        isDead = true;
        return;
      }

      if (!p.scored && p.x + p.w / 2 < birdX) {
        p.scored = true;
        if (p.isTop) score += 1;
      }
    }

    for (let i = pipes.length - 1; i >= 0; i--) {
      if (pipes[i].x < -200) pipes.splice(i, 1);
    }
  };

  // start run with first tap at t=0
  applyTap(0);

  while (!isDead && tMs < maxSimMs) {
    const delta = fixedStepMs;

    const frameStart = tMs;
    const frameEnd = tMs + delta;

    let localT = frameStart;

    while (tapIdx + 1 < taps.length && taps[tapIdx + 1] <= frameEnd) {
      const tapTime = taps[tapIdx + 1];

      const seg = tapTime - localT;
      if (seg > 0) {
        let remain = seg;
        let sub = 0;
        while (remain > 0 && sub < maxSubSteps) {
          const s = Math.min(remain, fixedStepMs);
          stepFixed(s);
          if (isDead) break;
          remain -= s;
          sub++;
        }
      }
      if (isDead) break;

      applyTap(tapTime);

      tapIdx++;
      localT = tapTime;
    }

    if (isDead) break;

    const rem = frameEnd - localT;
    if (rem > 0) {
      let remain = rem;
      let sub = 0;
      while (remain > 0 && sub < maxSubSteps) {
        const s = Math.min(remain, fixedStepMs);
        stepFixed(s);
        if (isDead) break;
        remain -= s;
        sub++;
      }
    }

    if (isDead) break;

    tMs = frameEnd;
  }

  // hard fail if run "too long"
  if (tMs >= maxSimMs) return { ok: false, error: "RUN_TOO_LONG" };

  return { ok: true, score, diedAtMs: Math.floor(tMs) };
}
