// src/lib/runs.ts
const RUNS_KEY = "seeky_runs"; // daily free pool (expires daily)
const DATE_KEY = "seeky_runs_date_utc";

const NORMAL_TICKET_KEY = "seeky_ticket_normal_v1";
const DAILY_TICKET_KEY = "seeky_ticket_daily_v1";
const SUPERPRIZE_TICKET_KEY = "seeky_ticket_superprize_v1";

export type PaidMode = "normal" | "daily" | "superprize";

const MAX_DAILY_FREE_RUNS = 6;

function clampRuns(n: number): number {
  const x = Math.floor(Number(n) || 0);
  return Math.max(0, Math.min(MAX_DAILY_FREE_RUNS, x));
}

function safeInt(raw: string | null, fallback = 0): number {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

function todayUtcISO(nowMs = Date.now()): string {
  const d = new Date(nowMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function emitUpdate() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("seeky:update"));
  }
}

export function getRuns(): number {
  if (typeof window === "undefined") return 0;
  return clampRuns(safeInt(localStorage.getItem(RUNS_KEY), 0));
}

export function setRuns(value: number) {
  if (typeof window === "undefined") return;
  const v = clampRuns(value);
  localStorage.setItem(RUNS_KEY, String(v));
  emitUpdate();
}

export function consumeRun() {
  const runs = getRuns();
  setRuns(runs - 1);
}

export function addRun(amount = 1) {
  const a = Number(amount);
  if (!Number.isFinite(a) || a <= 0) return;
  const runs = getRuns();
  setRuns(runs + Math.floor(a));
}

/**
 * ✅ Reset quotidien (UTC) de la pool free runs
 * Règle: à chaque nouveau jour, la pool est remise à EXACTEMENT 1
 * (donc les runs non consommés expirent).
 */
export function resetDailyRunsIfNeeded() {
  if (typeof window === "undefined") return;

  const today = todayUtcISO();
  const lastDate = localStorage.getItem(DATE_KEY);

  if (lastDate !== today) {
    localStorage.setItem(DATE_KEY, today);

    // ✅ reset strict : 1 run gratuite par jour, le reste expire
    localStorage.setItem(RUNS_KEY, "1");

    emitUpdate();
  } else {
    // ✅ hard clamp au cas où (anti-incohérences)
    const cur = getRuns();
    const clamped = clampRuns(cur);
    if (cur !== clamped) {
      localStorage.setItem(RUNS_KEY, String(clamped));
      emitUpdate();
    }
  }
}

function keyForMode(mode: PaidMode) {
  if (mode === "daily") return DAILY_TICKET_KEY;
  if (mode === "superprize") return SUPERPRIZE_TICKET_KEY;
  return NORMAL_TICKET_KEY;
}

export function getPaidTickets(mode: PaidMode): number {
  if (typeof window === "undefined") return 0;
  return safeInt(localStorage.getItem(keyForMode(mode)), 0);
}

export function addPaidTicket(mode: PaidMode, amount = 1) {
  if (typeof window === "undefined") return;

  const a = Number(amount);
  if (!Number.isFinite(a) || a <= 0) return;

  const k = keyForMode(mode);
  const cur = getPaidTickets(mode);
  localStorage.setItem(k, String(cur + Math.floor(a)));
  emitUpdate();
}

export function consumePaidTicket(mode: PaidMode) {
  if (typeof window === "undefined") return;

  const k = keyForMode(mode);
  const cur = getPaidTickets(mode);
  localStorage.setItem(k, String(Math.max(0, cur - 1)));
  emitUpdate();
}
