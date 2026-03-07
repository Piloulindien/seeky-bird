// src/lib/spin.ts
const SPIN_DATE_KEY = "seeky_spin_date_utc_v1"; // jour UTC où le spin est “consommé”
const SPIN_PENDING_KEY = "seeky_spin_pending_v2"; // résultat en attente de claim (number)

function todayUtcISO(nowMs = Date.now()): string {
  const d = new Date(nowMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function readPending(): number {
  if (typeof window === "undefined") return 0;
  const n = Number(localStorage.getItem(SPIN_PENDING_KEY) || "0");
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

/**
 * If the day changed (UTC), pending spin should not carry over.
 */
function purgePendingIfDayChanged() {
  if (typeof window === "undefined") return;
  const today = todayUtcISO();
  const last = localStorage.getItem(SPIN_DATE_KEY);

  // If there is pending but last day is different, drop it (daily-expiring semantics)
  if (last && last !== today) {
    if (readPending() > 0) localStorage.removeItem(SPIN_PENDING_KEY);
  }
}

export function shouldAutoOpenSpin(): boolean {
  if (typeof window === "undefined") return false;

  purgePendingIfDayChanged();

  const last = localStorage.getItem(SPIN_DATE_KEY);
  const pending = readPending();

  // opens if not used today (UTC) and no pending to claim
  return last !== todayUtcISO() && pending === 0;
}

export function canSpinToday(): boolean {
  if (typeof window === "undefined") return false;

  purgePendingIfDayChanged();

  const last = localStorage.getItem(SPIN_DATE_KEY);
  return last !== todayUtcISO();
}

export function getPendingSpin(): number {
  if (typeof window === "undefined") return 0;

  purgePendingIfDayChanged();

  return readPending();
}

export function spinOnce(): { runsWon: number } {
  if (typeof window === "undefined") return { runsWon: 0 };
  if (!canSpinToday()) return { runsWon: 0 };

  // Distribution: 1..5 runs (never 0)
  const r = Math.random();
  const runsWon = r < 0.5 ? 1 : r < 0.8 ? 2 : r < 0.93 ? 3 : r < 0.985 ? 4 : 5;

  // store pending + mark day as used (UTC)
  localStorage.setItem(SPIN_PENDING_KEY, String(runsWon));
  localStorage.setItem(SPIN_DATE_KEY, todayUtcISO());

  return { runsWon };
}

export function claimSpin(): number {
  if (typeof window === "undefined") return 0;

  purgePendingIfDayChanged();

  const pending = readPending();
  if (pending > 0) {
    localStorage.removeItem(SPIN_PENDING_KEY);
    return pending;
  }
  return 0;
}

export function resetSpinForDebug() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(SPIN_DATE_KEY);
  localStorage.removeItem(SPIN_PENDING_KEY);
}
