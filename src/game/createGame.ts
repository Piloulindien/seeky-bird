// src/game/createGame.ts
import * as Phaser from "phaser";
import { SeekyScene } from "./scene";
import type { GameMode } from "./scene";

type HudTopRow = { name: string; score: number };

type NormalState = {
  ok: boolean;
  currentRoundId?: number;
  status?: "live" | "locked";
  lockedAt?: number | null;
  graceMs?: number;
  thresholdSol?: number;
};

export function createGame(
  containerId: string,
  mode: GameMode,
  onGameOver?: (score: number, mode: GameMode) => void,
  hud?: {
    runs: number;
    poolSol: number;
    thresholdSol?: number;

    getPoolSol?: () => number;
    getRuns?: () => number;

    // ranking
    getRankInfo?: (score: number) => { rank: number; inTop10: boolean };

    // cutoff (Top10 in normal, Top3 in superprize)
    getTop10CutoffScore?: () => number | null;

    // Top list (Top10/Top3 depending on mode)
    getTopList?: () => HudTopRow[];
  },
  onRunStart?: (mode: GameMode) => void,

  // NEW: determinism + input capture
  opts?: {
    runSeed?: number;
    onTap?: (tMs: number, mode: GameMode) => void;
  },
) {
  const container =
    typeof document !== "undefined"
      ? (document.getElementById(containerId) as HTMLElement | null)
      : null;

  const shouldShowHud = mode !== "training";
  const isSuperPrize = () => mode === "superprize";
  const isDaily = () => mode === "daily";
  const isNormal = () => mode === "normal";

  let hudEl: HTMLDivElement | null = null;
  let titleLine: HTMLDivElement | null = null;
  let roundLine: HTMLDivElement | null = null;
  let poolLine: HTMLDivElement | null = null;
  let runsLine: HTMLDivElement | null = null;
  let rankLine: HTMLDivElement | null = null;
  let deltaLine: HTMLDivElement | null = null;

  let refreshTimer: number | null = null;
  let roundTimer: number | null = null;

  // last score used by refresh
  let lastScore = 0;

  // server normal state cache (for round line)
  let normalState: NormalState | null = null;

  function formatSol(n: number) {
    const x = Number(n) || 0;
    return x.toFixed(3);
  }

  function getThresholdSol(): number {
    const t = Number(hud?.thresholdSol);
    return Number.isFinite(t) ? t : 0.5;
  }

  function getPoolNow(): number {
    if (!hud) return 0;
    try {
      if (typeof hud.getPoolSol === "function") {
        const v = hud.getPoolSol();
        return Number.isFinite(v) ? v : hud.poolSol;
      }
    } catch {}
    return hud.poolSol;
  }

  function getRunsNow(): number {
    if (!hud) return 0;
    try {
      if (typeof hud.getRuns === "function") {
        const v = hud.getRuns();
        return Number.isFinite(v) ? v : hud.runs;
      }
    } catch {}
    return hud.runs;
  }

  function getCutoffScore(): number | null {
    if (!hud || typeof hud.getTop10CutoffScore !== "function") return null;
    try {
      const v = hud.getTop10CutoffScore();
      return typeof v === "number" && Number.isFinite(v) ? v : null;
    } catch {
      return null;
    }
  }

  function getTopList(): HudTopRow[] {
    if (!hud || typeof hud.getTopList !== "function") return [];
    try {
      const rows = hud.getTopList();
      return Array.isArray(rows) ? rows : [];
    } catch {
      return [];
    }
  }

  function renderTitleLine() {
    if (!titleLine) return;
    if (isSuperPrize()) {
      titleLine.style.display = "block";
      titleLine.textContent = "SuperPrize";
      titleLine.style.opacity = "0.95";
      return;
    }
    titleLine.textContent = "";
    titleLine.style.display = "none";
  }

  function computeNormalRoundLine(): string {
    const ns = normalState;
    if (!ns?.ok) return "Round —";

    const rid = Number(ns.currentRoundId || 0);
    if (!rid) return "Round —";

    const st = ns.status;
    const lockedAt = ns.lockedAt ?? null;
    const graceMs = Number(ns.graceMs || 180_000);

    if (st !== "locked" || !lockedAt) return `Round #${rid}`;

    const now = Date.now();
    const settleIn = Math.max(0, graceMs - (now - lockedAt));
    const s = Math.ceil(settleIn / 1000);

    if (s <= 0) return `Round #${rid} · settling…`;
    return `Round #${rid} · settlement in ~${s}s`;
  }

  function renderRoundLine() {
    if (!roundLine) return;

    if (!isNormal()) {
      roundLine.textContent = "";
      roundLine.style.display = "none";
      return;
    }

    roundLine.style.display = "block";
    roundLine.textContent = computeNormalRoundLine();
  }

  function renderPoolLine(poolOverride?: number) {
    const el = poolLine;
    if (!el) return;

    if (!hud) {
      el.textContent = "";
      return;
    }

    const poolSolNow =
      typeof poolOverride === "number" ? poolOverride : getPoolNow();

    if (isDaily()) {
      el.textContent = `Daily pool: ${formatSol(poolSolNow)} SOL`;
      return;
    }

    if (isSuperPrize()) {
      el.textContent = `Prize pool: ${formatSol(poolSolNow)} SOL`;
      return;
    }

    const thresholdSol = getThresholdSol();
    el.textContent = `Pool: ${formatSol(poolSolNow)} / ${formatSol(
      thresholdSol,
    )} SOL`;
  }

  function renderRunsLine(runsOverride?: number) {
    const el = runsLine;
    if (!el) return;

    if (isDaily() || isSuperPrize()) {
      el.textContent = "";
      el.style.display = "none";
      return;
    }

    if (!hud) {
      el.textContent = "";
      return;
    }

    const r = typeof runsOverride === "number" ? runsOverride : getRunsNow();
    el.style.display = "block";
    el.textContent = `Runs: ${Math.max(0, Math.floor(r))}`;
  }

  function renderRank(score: number) {
    const el = rankLine;
    if (!el) return;

    if (!hud || typeof hud.getRankInfo !== "function") {
      el.textContent = "Rank: —";
      el.style.color = "rgba(255,255,255,0.85)";
      return;
    }

    const info = hud.getRankInfo(score);
    const rank = Number(info?.rank) || 0;
    const inTop = Boolean(info?.inTop10);

    el.textContent = rank > 0 ? `Rank: #${rank}` : "Rank: —";
    el.style.color = inTop ? "#22c55e" : "#ef4444";
  }

  function renderDeltaToTop(score: number) {
    const el = deltaLine;
    if (!el) return;

    // SUPERPRIZE + DAILY => show Top3
    if (isSuperPrize() || isDaily()) {
      const top = getTopList().slice(0, 3);
      el.style.display = "block";
      el.style.opacity = "0.92";
      el.style.color = "rgba(255,255,255,0.9)";
      el.style.whiteSpace = "pre-line";

      const a = top[0]?.score;
      const b = top[1]?.score;
      const c = top[2]?.score;

      el.textContent =
        `Top3:\n` +
        `1. ${typeof a === "number" ? a : "—"}\n` +
        `2. ${typeof b === "number" ? b : "—"}\n` +
        `3. ${typeof c === "number" ? c : "—"}`;

      return;
    }

    // NORMAL => “Need +X…”
    if (!hud || typeof hud.getTop10CutoffScore !== "function") {
      el.textContent = "";
      el.style.display = "none";
      return;
    }

    const cutoff = getCutoffScore();
    const label = "Top10";

    el.style.display = "block";
    el.style.opacity = "0.92";

    if (cutoff == null) {
      el.textContent = `${label}: open`;
      el.style.color = "rgba(255,255,255,0.85)";
      return;
    }

    const s = Number(score) || 0;
    const need = Math.max(0, cutoff - s + 1);

    if (need <= 0) {
      el.textContent = `${label} reached ✅`;
      el.style.color = "#22c55e";
      return;
    }

    el.textContent = `Need +${need} to enter ${label}`;
    el.style.color = "#ef4444";
  }

  function renderRankAndDelta(score: number) {
    renderRank(score);
    renderDeltaToTop(score);
  }

  async function fetchNormalStateOnce() {
    if (typeof window === "undefined") return;
    if (!isNormal()) return;

    try {
      const r = await fetch("/api/normal/status", { cache: "no-store" });
      if (!r.ok) return;
      const j = await r.json().catch(() => null);
      if (!j?.round) return;

      normalState = {
        ok: true,
        currentRoundId: j.round.id,
        status: j.round.status,
        lockedAt: j.round.lockedAt,
        graceMs: j.graceMs,
      };
    } catch {}
  }

  // Build HUD
  if (container && shouldShowHud) {
    const prevPos = container.style.position;
    if (!prevPos || prevPos === "static") container.style.position = "relative";

    hudEl = document.createElement("div");
    hudEl.style.position = "absolute";
    hudEl.style.right = "10px";
    hudEl.style.top = "10px";
    hudEl.style.zIndex = "50";
    hudEl.style.pointerEvents = "none";
    hudEl.style.padding = "10px 12px";
    hudEl.style.borderRadius = "14px";
    hudEl.style.border = "1px solid rgba(255,255,255,0.14)";
    hudEl.style.background = "rgba(0,0,0,0.38)";
    hudEl.style.color = "white";
    hudEl.style.fontFamily =
      "system-ui, -apple-system, Segoe UI, Roboto, Arial";
    hudEl.style.fontSize = "12px";
    hudEl.style.fontWeight = "700";
    hudEl.style.backdropFilter = "blur(6px)";
    // @ts-expect-error safari
    hudEl.style.webkitBackdropFilter = "blur(6px)";
    hudEl.style.textAlign = "right";
    hudEl.style.lineHeight = "1.2";

    titleLine = document.createElement("div");
    titleLine.style.fontSize = "18px";
    titleLine.style.fontWeight = "900";
    titleLine.style.marginBottom = "6px";

    roundLine = document.createElement("div");
    roundLine.style.marginTop = "2px";
    roundLine.style.opacity = "0.9";

    runsLine = document.createElement("div");
    runsLine.style.marginTop = "4px";
    runsLine.style.fontWeight = "800";
    runsLine.style.opacity = "0.95";

    poolLine = document.createElement("div");

    rankLine = document.createElement("div");
    rankLine.style.marginTop = "4px";
    rankLine.style.fontWeight = "800";

    deltaLine = document.createElement("div");
    deltaLine.style.marginTop = "6px";
    deltaLine.style.fontWeight = "800";

    hudEl.appendChild(titleLine);
    hudEl.appendChild(roundLine);
    hudEl.appendChild(runsLine);
    hudEl.appendChild(poolLine);
    hudEl.appendChild(rankLine);
    hudEl.appendChild(deltaLine);

    renderTitleLine();
    renderRunsLine();
    renderPoolLine();
    renderRankAndDelta(0);

    container.appendChild(hudEl);
  }

  // Scene HUD (only what scene expects)
  const sceneHud = hud
    ? { runs: hud.runs, poolSol: hud.poolSol, thresholdSol: hud.thresholdSol }
    : undefined;

  const scene = new SeekyScene(
    mode,
    onGameOver,
    sceneHud,
    onRunStart,
    Math.floor(Number(opts?.runSeed) || 0),
  );

  const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    parent: containerId,
    width: 390,
    height: 720,
    scene: [scene],
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    render: { roundPixels: false },
    fps: { target: 60, forceSetTimeOut: false },
  };

  const game = new Phaser.Game(config);

  // Score updates from the scene
  const onScore = (payload: unknown) => {
    const p = payload as { score?: number };
    const score = Number(p?.score) || 0;
    lastScore = score;
    renderRankAndDelta(score);
  };

  // Tap capture from the scene (tMs since run start)
  const onTap = (payload: unknown) => {
    const p = payload as { tMs?: number; mode?: GameMode };
    const tMs = Math.max(0, Math.floor(Number(p?.tMs) || 0));
    const m = (p?.mode as GameMode) || mode;
    opts?.onTap?.(tMs, m);
  };

  game.events.once(Phaser.Core.Events.READY, () => {
    try {
      const s = game.scene.getScene("SeekyScene") as SeekyScene | undefined;
      s?.events?.on("seeky:score", onScore);
      s?.events?.on("seeky:tap", onTap);
    } catch {}
  });

  // Live HUD refresh (pool + runs + top list)
  if (shouldShowHud && hud && typeof window !== "undefined") {
    refreshTimer = window.setInterval(() => {
      try {
        renderTitleLine();
        renderRunsLine(getRunsNow());
        renderPoolLine(getPoolNow());
        renderDeltaToTop(lastScore);
      } catch {}
    }, 700);
  }

  // Round UI refresh (normal only) — server-based
  if (shouldShowHud && isNormal() && typeof window !== "undefined") {
    void fetchNormalStateOnce();
    renderRoundLine();

    roundTimer = window.setInterval(() => {
      void fetchNormalStateOnce();
      renderRoundLine();
    }, 900);
  }

  return {
    destroy(removeCanvas?: boolean) {
      try {
        const s = game.scene.getScene("SeekyScene") as SeekyScene | undefined;
        s?.events?.off("seeky:score", onScore);
        s?.events?.off("seeky:tap", onTap);
      } catch {}

      try {
        if (refreshTimer) window.clearInterval(refreshTimer);
      } catch {}
      refreshTimer = null;

      try {
        if (roundTimer) window.clearInterval(roundTimer);
      } catch {}
      roundTimer = null;

      try {
        hudEl?.remove();
      } catch {}
      hudEl = null;

      titleLine = null;
      roundLine = null;
      poolLine = null;
      runsLine = null;
      rankLine = null;
      deltaLine = null;

      game.destroy(!!removeCanvas);
    },
  };
}
