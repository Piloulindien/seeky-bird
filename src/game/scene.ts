// src/game/scene.ts
import * as Phaser from "phaser";

type Pipe = Phaser.GameObjects.Rectangle & {
  isTop: boolean;
  scored: boolean;
  pairId: number;
};

type Cloud = {
  parts: Phaser.GameObjects.Ellipse[];
};

export type GameMode = "normal" | "training" | "daily" | "superprize";
export type OnGameOver = (score: number, mode: GameMode) => void;

export class SeekyScene extends Phaser.Scene {
  private clouds: Cloud[] = [];
  private bird!: Phaser.GameObjects.Container;
  private birdBody!: Phaser.GameObjects.Arc; // (pas encore utilisé, ok)
  private velocityY = 0;
  private wingTween?: Phaser.Tweens.Tween;
  private lastTapAt = 0;
  private coyoteMs = 80;
  private started = false;
  private readyText?: Phaser.GameObjects.Text;

  // HUD (injecté depuis React au démarrage)
  private initialHud?: { runs: number; poolSol: number; thresholdSol?: number };
  private hudLeft!: Phaser.GameObjects.Text;
  private hudRight!: Phaser.GameObjects.Text;
  private hudRuns = 0;
  private hudPool = 0;

  private ground!: Phaser.GameObjects.TileSprite;
  private groundY = 0;

  private gravity = 900;
  private flapStrength = -300;

  private pipes!: Phaser.GameObjects.Group;
  private spawnTimer = 0;
  private spawnEveryMs = 1350;

  private baseSpeed = 260;
  private speed = 260;
  private maxSpeed = 340;

  private baseGap = 170;
  private gap = 170;
  private minGap = 130;

  private elapsedMs = 0;
  private pipesSpawned = 0;

  private score = 0;
  private scoreText!: Phaser.GameObjects.Text;

  private trailTimerMs = 0;
  private trailEveryMs = 45; // plus petit = plus dense

  private nextPairId = 1;
  private isDead = false;

  private mode: GameMode = "normal";
  private onGameOver?: OnGameOver;
  private onRunStart?: (mode: GameMode) => void;

  // NEW: determinism
  private seed = 0;

  // NEW: fixed-step
  private accMs = 0;
  private fixedStepMs = 1000 / 60; // 60Hz
  private maxSubSteps = 5;

  // NEW: run timing for tap capture
  private runStartMs = 0;

  private sfx = {
    flap: () => {},
    score: () => {},
    hit: () => {},
  };

  constructor(
    mode: GameMode = "normal",
    onGameOver?: OnGameOver,
    hud?: { runs: number; poolSol: number; thresholdSol?: number },
    onRunStart?: (mode: GameMode) => void,
    runSeed = 0,
  ) {
    super("SeekyScene");
    this.mode = mode;
    this.onGameOver = onGameOver;
    this.initialHud = hud;
    this.onRunStart = onRunStart;
    this.seed = Math.floor(Number(runSeed) || 0);
  }

  // --- Deterministic RNG (LCG 32-bit) ---
  private rnd01(): number {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 0x100000000;
  }

  private rndInt(min: number, max: number): number {
    const a = Math.min(min, max);
    const b = Math.max(min, max);
    return a + Math.floor(this.rnd01() * (b - a + 1));
  }

  create() {
    let audioUnlocked = false;

    const { width, height } = this.scale;

    // ✅ Valeurs HUD au lancement
    this.hudRuns = this.initialHud?.runs ?? 0;
    this.hudPool = this.initialHud?.poolSol ?? 0;

    this.cameras.main.setBackgroundColor("#0f172a");

    // gradient sky
    const g = this.add.graphics();
    g.fillGradientStyle(0x0f172a, 0x0f172a, 0x1e293b, 0x1e293b, 1);
    g.fillRect(0, 0, width, height);
    g.setDepth(-100);

    // clouds
    this.clouds = [];
    for (let i = 0; i < 6; i++) {
      const baseX = Phaser.Math.Between(0, width);
      const baseY = Phaser.Math.Between(60, height - 120);

      const parts: Phaser.GameObjects.Ellipse[] = [];
      for (let j = 0; j < 4; j++) {
        const p = this.add.ellipse(
          baseX + Phaser.Math.Between(-30, 30),
          baseY + Phaser.Math.Between(-10, 10),
          Phaser.Math.Between(50, 80),
          Phaser.Math.Between(30, 45),
          0xffffff,
          0.08,
        );
        p.setDepth(-50);
        parts.push(p);
      }

      this.clouds.push({ parts });
    }

    // horizon line
    this.add
      .rectangle(width / 2, height - 120, width, 2, 0xffffff, 0.06)
      .setDepth(-40);

    // scrolling ground
    this.groundY = height - 90;
    this.ground = this.add
      .tileSprite(0, this.groundY, width, 90, "")
      .setOrigin(0, 0)
      .setDepth(-30);

    // fake ground texture
    const gtex = this.add.graphics();
    gtex.fillStyle(0x0b1220, 1);
    gtex.fillRect(0, 0, 64, 64);
    gtex.fillStyle(0x111827, 1);
    for (let i = 0; i < 64; i += 8) gtex.fillRect(i, 40, 4, 24);
    gtex.generateTexture("groundTex", 64, 64);
    gtex.destroy();
    this.ground.setTexture("groundTex");

    // --- Simple SFX (no assets) ---
    const audioCtx =
      typeof window !== "undefined"
        ? new (
            window.AudioContext ||
            (window as unknown as { webkitAudioContext?: typeof AudioContext })
              .webkitAudioContext
          )()
        : null;

    const beep = (
      freq: number,
      durationMs: number,
      type: OscillatorType,
      gain = 0.03,
    ) => {
      if (!audioCtx) return;
      const osc = audioCtx.createOscillator();
      const gg = audioCtx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gg.gain.value = gain;
      osc.connect(gg);
      gg.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + durationMs / 1000);
    };

    this.sfx.flap = () => beep(520, 45, "square", 0.02);
    this.sfx.score = () => beep(880, 55, "sine", 0.03);
    this.sfx.hit = () => beep(220, 160, "triangle", 0.06);

    // Bird
    const bx = width * 0.35;
    const by = height * 0.5;

    const body = this.add
      .ellipse(0, 0, 28, 22, 0x60a5fa)
      .setStrokeStyle(2, 0x93c5fd, 1);

    const wing = this.add.graphics();
    wing.fillStyle(0x1d4ed8, 0.9);
    wing.fillCircle(0, 0, 8);
    wing.fillCircle(6, 2, 8);
    wing.setPosition(-10, 6);

    const eyeWhite = this.add.circle(6, -4, 4, 0xffffff, 0.95);
    const eyePupil = this.add.circle(7, -4, 2, 0x0b1220, 0.9);

    const beak = this.add.graphics();
    beak.fillStyle(0xfbbf24, 1);
    beak.fillTriangle(12, -2, 18, 1, 12, 4);

    this.bird = this.add.container(bx, by, [
      wing,
      body,
      eyeWhite,
      eyePupil,
      beak,
    ]);
    this.bird.setDepth(5);

    this.velocityY = 0;
    this.isDead = false;

    this.started = false;
    this.accMs = 0;
    this.runStartMs = 0;

    // petit texte "Tap to start"
    this.readyText?.destroy();
    this.readyText = this.add
      .text(width / 2, height * 0.42, "TAP TO START", {
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial",
        fontSize: "18px",
        color: "#ffffff",
      })
      .setOrigin(0.5)
      .setDepth(25)
      .setAlpha(0.85);

    this.tweens.add({
      targets: this.readyText,
      alpha: 0.35,
      duration: 600,
      yoyo: true,
      repeat: -1,
    });

    this.pipes = this.add.group();
    this.spawnTimer = 0;
    this.score = 0;

    this.elapsedMs = 0;
    this.pipesSpawned = 0;

    if (this.mode === "training") {
      this.speed = this.baseSpeed;
      this.gap = Math.round(this.baseGap * 1.12);
    } else {
      this.speed = this.baseSpeed;
      this.gap = this.baseGap;
    }

    // Score
    const scoreY = this.mode === "daily" ? 56 : 16;

    this.scoreText = this.add.text(16, scoreY, `Score: ${this.score}`, {
      fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial",
      fontSize: "18px",
      color: "#ffffff",
      backgroundColor: "rgba(0,0,0,0.35)",
      padding: { x: 8, y: 6 },
    });
    this.scoreText.setDepth(20);

    // init rank HUD
    this.events.emit("seeky:score", { score: this.score, mode: this.mode });

    // Input
    this.input.on("pointerdown", () => {
      if (!audioUnlocked) {
        audioUnlocked = true;
        try {
          this.sfx.flap();
        } catch {}
      }

      if (this.isDead) return;

      // ✅ 1er tap = démarre la run
      if (!this.started) {
        this.started = true;
        this.spawnTimer = 0;
        this.readyText?.destroy();
        this.readyText = undefined;

        // reference time for tap capture
        this.runStartMs = this.time.now;

        // ✅ charge l'entry seulement au démarrage réel
        this.onRunStart?.(this.mode);
      }

      this.lastTapAt = this.time.now;

      this.sfx.flap();
      this.velocityY = this.flapStrength;

      // squash & stretch
      this.bird.setScale(1.15, 0.85);

      // battement d’aile
      this.wingTween?.stop();
      wing.setScale(1, 1);

      this.tweens.add({
        targets: wing,
        scaleY: 0.75,
        scaleX: 0.92,
        yoyo: true,
        repeat: 0,
        duration: 120,
      });

      // NEW: emit tap event for server-authoritative replay (ms since run start)
      if (this.runStartMs > 0) {
        const tMs = Math.max(0, Math.floor(this.time.now - this.runStartMs));
        this.events.emit("seeky:tap", { tMs, mode: this.mode });
      }
    });

    this.nextPairId = 1;
  }

  update(_time: number, delta: number) {
    // clamp: évite gros delta au (re)focus / restart
    delta = Math.min(delta, 50);

    // ground scroll (visual only; ok to keep variable dt)
    const dtV = delta / 1000;
    this.ground.tilePositionX += 120 * dtV;

    // clouds (visual only)
    const cloudSpeed = 10 * dtV;
    for (const cloud of this.clouds) {
      for (const p of cloud.parts) {
        p.x -= cloudSpeed;
        if (p.x < -140) p.x = this.scale.width + 140;
      }
    }

    if (this.isDead) return;

    if (!this.started) {
      // léger flottement (visuel), pas de gravité/pipes
      const t = this.time.now * 0.004;
      this.bird.y = this.scale.height * 0.5 + Math.sin(t) * 6;
      this.velocityY = 0;
      this.bird.rotation = 0;
      this.accMs = 0; // keep deterministic start
      return;
    }

    // fixed-step simulation
    this.accMs += delta;

    let steps = 0;
    while (this.accMs >= this.fixedStepMs && steps < this.maxSubSteps) {
      this.stepFixed(this.fixedStepMs);
      this.accMs -= this.fixedStepMs;
      steps++;
      if (this.isDead) break;
    }
  }

  private stepFixed(stepMs: number) {
    const dt = stepMs / 1000;

    // Trail (arcade)
    this.trailTimerMs += stepMs;
    if (this.trailTimerMs >= this.trailEveryMs) {
      this.trailTimerMs = 0;
    }

    if (
      this.mode === "normal" ||
      this.mode === "daily" ||
      this.mode === "superprize"
    ) {
      this.speed = this.baseSpeed;
      this.gap = this.baseGap;
    }

    // bird physics
    this.velocityY += this.gravity * dt;
    this.bird.y += this.velocityY * dt;
    this.bird.rotation = Phaser.Math.Clamp(this.velocityY / 400, -0.7, 1.0);

    // death bounds
    if (this.bird.y < 0 || this.bird.y > this.groundY) {
      const sinceTap = this.time.now - this.lastTapAt;
      if (sinceTap > this.coyoteMs) {
        this.die();
        return;
      }
    }

    // spawn
    this.spawnTimer += stepMs;
    if (this.spawnTimer >= this.spawnEveryMs) {
      this.spawnTimer = 0;
      this.spawnPipePair();
      this.pipesSpawned += 1;
    }

    // 1) Déplacer + détecter les pairs à supprimer
    const children = this.pipes.getChildren() as Phaser.GameObjects.Rectangle[];
    const toRemove = new Set<number>();

    for (const obj of children) {
      obj.x -= this.speed * dt;

      const pairId = obj.getData("pairId") as number | undefined;

      if (obj.x < -120 && typeof pairId === "number") {
        toRemove.add(pairId);
      }
    }

    // 2) Cleanup en une passe (évite le O(n²))
    if (toRemove.size > 0) {
      const children2 =
        this.pipes.getChildren() as Phaser.GameObjects.Rectangle[];
      for (const obj of children2) {
        const pairId = obj.getData("pairId") as number | undefined;
        if (typeof pairId === "number" && toRemove.has(pairId)) {
          this.pipes.remove(obj, true, true);
        }
      }
    }

    // 3) Collisions + scoring (uniquement sur pipes)
    const children3 =
      this.pipes.getChildren() as Phaser.GameObjects.Rectangle[];
    for (const obj of children3) {
      const isPipe = Boolean(obj.getData("isPipe"));
      const isTop = obj.getData("isTop") as boolean | undefined;
      const scored = Boolean(obj.getData("scored"));

      if (!isPipe || typeof isTop !== "boolean") continue;

      const dx = Math.abs(obj.x - this.bird.x);
      const dy = Math.abs(obj.y - this.bird.y);

      if (dx < obj.displayWidth / 2 + 14 && dy < obj.displayHeight / 2 + 14) {
        this.die();
        return;
      }

      if (!scored && obj.x + obj.displayWidth / 2 < this.bird.x) {
        obj.setData("scored", true);

        if (isTop) {
          this.score += 1;
          this.scoreText.setText(`Score: ${this.score}`);
          this.events.emit("seeky:score", {
            score: this.score,
            mode: this.mode,
          });

          this.sfx.score();

          this.tweens.add({
            targets: this.scoreText,
            scaleX: 1.18,
            scaleY: 1.18,
            duration: 80,
            yoyo: true,
          });

          this.spawnPlusOne(this.bird.x + 40, this.bird.y - 18);
        }
      }
    }

    // ✅ cleanup APRES la boucle (ok)
    if (toRemove.size > 0) {
      this.pipes.getChildren().forEach((child) => {
        const obj = child as Phaser.GameObjects.Rectangle;
        const pid = obj.getData("pairId") as number | undefined;
        if (typeof pid === "number" && toRemove.has(pid)) {
          this.pipes.remove(obj, true, true);
        }
      });
    }
  }

  private refreshHud() {
    const thr = this.initialHud?.thresholdSol;
    if (typeof thr === "number" && this.mode === "normal") {
      this.hudLeft.setText(
        `Pool: ${this.hudPool.toFixed(3)} / ${thr.toFixed(3)} SOL`,
      );
    } else {
      this.hudLeft.setText(`Pool: ${this.hudPool.toFixed(3)} SOL`);
    }

    if (this.hudRight) {
      if (this.mode === "daily") {
        this.hudRight.setText("");
      } else {
        this.hudRight.setText("");
      }
    }
  }

  private spawnPipePair() {
    const { width, height } = this.scale;

    const pipeW = 70;
    const margin = 80;

    // NEW: deterministic RNG
    const gapY = this.rndInt(
      Math.floor(margin + this.gap / 2),
      Math.floor(height - margin - this.gap / 2),
    );

    const topH = gapY - this.gap / 2;
    const bottomY = gapY + this.gap / 2;
    const bottomH = height - bottomY;

    const x = width + 80;
    const pairId = this.nextPairId++;

    const baseColor = 0x22c55e;
    const glowColor = 0xa7f3d0;

    // ---- TOP PIPE ----
    const top = this.add.rectangle(
      x,
      topH / 2,
      pipeW,
      topH,
      baseColor,
      0.95,
    ) as Pipe;
    top.setStrokeStyle(2, glowColor, 0.95);

    top.isTop = true;
    top.scored = false;
    top.pairId = pairId;

    top.setData("isPipe", true);
    top.setData("isTop", true);
    top.setData("pairId", pairId);
    top.setData("scored", false);

    // ---- BOTTOM PIPE ----
    const bottom = this.add.rectangle(
      x,
      bottomY + bottomH / 2,
      pipeW,
      bottomH,
      baseColor,
      0.95,
    ) as Pipe;
    bottom.setStrokeStyle(2, glowColor, 0.95);

    bottom.isTop = false;
    bottom.scored = false;
    bottom.pairId = pairId;

    bottom.setData("isPipe", true);
    bottom.setData("isTop", false);
    bottom.setData("pairId", pairId);
    bottom.setData("scored", false);

    // ---- Caps (visuel) ----
    const capTop = this.add.rectangle(
      x,
      topH - 12,
      pipeW + 10,
      7,
      glowColor,
      0.95,
    );
    capTop.setData("pairId", pairId);
    capTop.setData("isPipe", false);

    const capBottom = this.add.rectangle(
      x,
      bottomY + 12,
      pipeW + 10,
      7,
      glowColor,
      0.95,
    );
    capBottom.setData("pairId", pairId);
    capBottom.setData("isPipe", false);

    this.pipes.add(top);
    this.pipes.add(bottom);
    this.pipes.add(capTop);
    this.pipes.add(capBottom);
  }

  private spawnPlusOne(x: number, y: number) {
    const t = this.add
      .text(x, y, "+1", {
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial",
        fontSize: "18px",
        color: "#ffffff",
        stroke: "#000000",
        strokeThickness: 4,
      })
      .setOrigin(0.5)
      .setDepth(30)
      .setAlpha(0.95);

    this.tweens.add({
      targets: t,
      y: y - 26,
      alpha: 0,
      duration: 420,
      ease: "Sine.easeOut",
      onComplete: () => t.destroy(),
    });
  }

  private die() {
    if (this.isDead) return;
    this.isDead = true;

    this.events.emit("game-over", { score: this.score, mode: this.mode });
    this.onGameOver?.(this.score, this.mode);

    this.sfx.hit();

    this.input.once("pointerdown", () => {
      this.scene.restart();
    });
  }
}
