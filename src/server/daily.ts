import { db, nowMs } from "./db";
import { ECONOMY } from "@/lib/economy";

export type DailyTopRow = { wallet: string; name: string; score: number };

export type DailyDayState = {
  day: string;
  status: "open" | "settled";
  createdAt: number;
  settledAt: number | null;
  poolSol: number;
  entriesCount: number;
};

export type DailyStatusResponse = {
  day: DailyDayState;
  top3: DailyTopRow[];
};

export type DailyDistribution = {
  date: string;
  poolSol: number;
  payouts: Array<{
    rank: number;
    wallet: string;
    name: string;
    score: number;
    amountSol: number;
  }>;
  payoutTxSigs?: string[];
  top3Snapshot?: DailyTopRow[];
};

const DAILY = {
  entrySol: ECONOMY.entrySol,
  rewardsShare: ECONOMY.take?.rewards ?? 1,
  payoutWeightsTop3: [0.6, 0.3, 0.1] as const,
} as const;

function round6(n: number) {
  return Math.round(n * 1_000_000) / 1_000_000;
}

function clampInt(n: unknown): number {
  const x = Math.floor(Number(n || 0));
  return Number.isFinite(x) ? x : 0;
}

function safeDayString(day: unknown): string {
  return String(day || "").trim();
}

function utcDayNow(ts = nowMs()): string {
  const d = new Date(ts);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseDayToUtcMs(day: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return Date.UTC(y, mo - 1, d, 0, 0, 0, 0);
}

function endOfUtcDayMs(day: string): number | null {
  const start = parseDayToUtcMs(day);
  if (start == null) return null;
  return start + 24 * 60 * 60 * 1000;
}

function parseJsonStringArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v)
      ? v.map((x) => String(x || "").trim()).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

function ensureUser(
  wallet: string,
  name: string,
): { ok: true } | { ok: false; error: string } {
  const existing = db
    .prepare(`SELECT name FROM users WHERE wallet=?`)
    .get(wallet) as { name: string } | undefined;

  if (!existing) {
    db.prepare(`INSERT INTO users(wallet,name) VALUES(?,?)`).run(wallet, name);
    return { ok: true };
  }
  if (existing.name !== name) return { ok: false, error: "NAME_IMMUTABLE" };
  return { ok: true };
}

function ensureDay(dayRaw?: string): DailyDayState {
  const day = safeDayString(dayRaw) || utcDayNow();

  const existing = db
    .prepare(`SELECT * FROM daily_days WHERE day=?`)
    .get(day) as DailyDayState | undefined;

  if (existing) return existing;

  const now = nowMs();
  db.prepare(
    `INSERT INTO daily_days(day,status,createdAt,settledAt,poolSol,entriesCount)
     VALUES(?, 'open', ?, NULL, 0, 0)`,
  ).run(day, now);

  return db
    .prepare(`SELECT * FROM daily_days WHERE day=?`)
    .get(day) as DailyDayState;
}

/**
 * Top3 for a day
 * - ORDER score desc, createdAt asc
 * - max 1 position per wallet
 */
function getDailyTop3Internal(day: string): DailyTopRow[] {
  const rows = db
    .prepare(
      `SELECT wallet, name, score, createdAt
       FROM daily_entries
       WHERE day=?
       ORDER BY score DESC, createdAt ASC`,
    )
    .all(day) as Array<{
    wallet: string;
    name: string;
    score: number;
    createdAt: number;
  }>;

  const out: DailyTopRow[] = [];
  const seen = new Set<string>();

  for (const r of rows) {
    if (seen.has(r.wallet)) continue;
    seen.add(r.wallet);
    out.push({ wallet: r.wallet, name: r.name, score: r.score });
    if (out.length >= 3) break;
  }

  return out;
}

function settlePastDaysIfReady() {
  const now = nowMs();
  const today = utcDayNow(now);

  const openDays = db
    .prepare(
      `SELECT * FROM daily_days
       WHERE status='open'
       ORDER BY day ASC
       LIMIT 60`,
    )
    .all() as DailyDayState[];

  for (const d of openDays) {
    if (!d.day || d.day >= today) continue;

    const endAt = endOfUtcDayMs(d.day);
    if (endAt == null) continue;
    if (now < endAt) continue;

    const top3 = getDailyTop3Internal(d.day);
    const n = Math.min(3, top3.length);
    const weights = DAILY.payoutWeightsTop3.slice(0, n);
    const sumW = weights.reduce((a, b) => a + b, 0);

    const payouts = top3.slice(0, n).map((p, i) => ({
      rank: i + 1,
      wallet: p.wallet,
      name: p.name,
      score: p.score,
      amountSol:
        sumW > 0 ? round6((Number(d.poolSol || 0) * weights[i]) / sumW) : 0,
    }));

    const tx = db.transaction(() => {
      db.prepare(`DELETE FROM daily_payouts WHERE day=?`).run(d.day);

      for (const p of payouts) {
        db.prepare(
          `INSERT INTO daily_payouts(day,rank,wallet,name,score,amountSol)
           VALUES(?,?,?,?,?,?)`,
        ).run(d.day, p.rank, p.wallet, p.name, p.score, p.amountSol);
      }

      db.prepare(
        `INSERT OR REPLACE INTO daily_distributions(day,at,poolSol,payoutTxSigs)
         VALUES(?,?,?,COALESCE((SELECT payoutTxSigs FROM daily_distributions WHERE day=?), NULL))`,
      ).run(d.day, now, Number(d.poolSol || 0), d.day);

      db.prepare(
        `UPDATE daily_days
         SET status='settled', settledAt=?
         WHERE day=?`,
      ).run(now, d.day);
    });

    tx();
  }
}

export function getDailyEntrySol(): number {
  return Number(DAILY.entrySol || 0.01);
}

export function getDailyStatus(dayRaw?: string): DailyStatusResponse {
  settlePastDaysIfReady();

  const day = safeDayString(dayRaw) || utcDayNow();
  const dd = ensureDay(day);
  const top3 = getDailyTop3Internal(day);

  return {
    day: {
      day: dd.day,
      status: dd.status,
      createdAt: dd.createdAt,
      settledAt: dd.settledAt,
      poolSol: Number(dd.poolSol || 0),
      entriesCount: clampInt(dd.entriesCount),
    },
    top3,
  };
}

export function recordDailyEntry(dayRaw?: string) {
  settlePastDaysIfReady();

  const day = safeDayString(dayRaw) || utcDayNow();
  const dd = ensureDay(day);

  if (dd.status !== "open") {
    return { ok: false as const, error: "DAY_NOT_OPEN" };
  }

  const addToPool = Number(getDailyEntrySol() * DAILY.rewardsShare);
  const nextPool = Number((Number(dd.poolSol || 0) + addToPool).toFixed(4));

  db.prepare(
    `UPDATE daily_days
     SET poolSol=?, entriesCount=entriesCount+1
     WHERE day=?`,
  ).run(nextPool, day);

  const updated = ensureDay(day);
  return {
    ok: true as const,
    day: {
      day: updated.day,
      status: updated.status,
      createdAt: updated.createdAt,
      settledAt: updated.settledAt,
      poolSol: Number(updated.poolSol || 0),
      entriesCount: clampInt(updated.entriesCount),
    },
  };
}

export function submitDailyScore(args: {
  wallet: string;
  name: string;
  score: number;
  startedAt: number;
  day?: string;
}): { ok: true } | { ok: false; error: string } {
  settlePastDaysIfReady();

  const day = safeDayString(args.day) || utcDayNow();
  const dd = ensureDay(day);

  if (dd.status !== "open") return { ok: false, error: "DAY_NOT_OPEN" };

  const wallet = String(args.wallet || "").trim();
  const name = String(args.name || "").trim();
  const score = Math.max(0, Math.floor(Number(args.score || 0)));
  const startedAt = Math.floor(Number(args.startedAt || 0));

  if (!wallet || wallet.length < 8) return { ok: false, error: "BAD_WALLET" };
  if (!name || name.length < 2) return { ok: false, error: "BAD_NAME" };
  if (!startedAt) return { ok: false, error: "BAD_STARTED_AT" };

  const u = ensureUser(wallet, name);
  if (!u.ok) return u;

  db.prepare(
    `INSERT INTO daily_entries(day,wallet,name,score,startedAt,createdAt)
     VALUES(?,?,?,?,?,?)`,
  ).run(day, wallet, name, score, startedAt, nowMs());

  settlePastDaysIfReady();

  return { ok: true };
}

export function getDailyHistory(
  limit = 50,
  offset = 0,
): { ok: true; items: DailyDistribution[]; limit: number; offset: number } {
  settlePastDaysIfReady();

  const l = Math.min(200, Math.max(1, Math.floor(limit)));
  const o = Math.max(0, Math.floor(offset));

  const dists = db
    .prepare(
      `SELECT day, at, poolSol, payoutTxSigs
       FROM daily_distributions
       ORDER BY at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(l, o) as Array<{
    day: string;
    at: number;
    poolSol: number;
    payoutTxSigs: string | null;
  }>;

  const pStmt = db.prepare(
    `SELECT rank, wallet, name, score, amountSol
     FROM daily_payouts
     WHERE day=?
     ORDER BY rank ASC`,
  );

  const items: DailyDistribution[] = dists.map((d) => {
    const payouts = pStmt.all(d.day) as Array<{
      rank: number;
      wallet: string;
      name: string;
      score: number;
      amountSol: number;
    }>;

    const top3Snapshot = getDailyTop3Internal(d.day);

    return {
      date: d.day,
      poolSol: Number(d.poolSol || 0),
      payouts: payouts.map((p) => ({
        rank: p.rank,
        wallet: p.wallet,
        name: p.name,
        score: p.score,
        amountSol: Number(p.amountSol || 0),
      })),
      payoutTxSigs: parseJsonStringArray(d.payoutTxSigs),
      top3Snapshot,
    };
  });

  return { ok: true, items, limit: l, offset: o };
}

export function adminSetDailyPool(dayRaw: string, poolSol: number) {
  const day = safeDayString(dayRaw) || utcDayNow();
  ensureDay(day);

  const v = Number(poolSol);
  if (!Number.isFinite(v) || v < 0) {
    return { ok: false as const, error: "BAD_POOL" };
  }

  db.prepare(`UPDATE daily_days SET poolSol=? WHERE day=?`).run(v, day);
  return { ok: true as const };
}

export function adminClearDailyTop(dayRaw?: string) {
  const day = safeDayString(dayRaw) || utcDayNow();
  ensureDay(day);

  db.prepare(`DELETE FROM daily_entries WHERE day=?`).run(day);
  db.prepare(`DELETE FROM daily_payouts WHERE day=?`).run(day);
  db.prepare(`DELETE FROM daily_distributions WHERE day=?`).run(day);

  return { ok: true as const };
}

export function getDailyDistributionByDay(
  dayRaw: string,
): DailyDistribution | null {
  const day = safeDayString(dayRaw);
  if (!day) return null;

  const dist = db
    .prepare(
      `SELECT day, at, poolSol, payoutTxSigs
       FROM daily_distributions
       WHERE day=?`,
    )
    .get(day) as
    | {
        day: string;
        at: number;
        poolSol: number;
        payoutTxSigs: string | null;
      }
    | undefined;

  if (!dist) return null;

  const payouts = db
    .prepare(
      `SELECT rank, wallet, name, score, amountSol
       FROM daily_payouts
       WHERE day=?
       ORDER BY rank ASC`,
    )
    .all(day) as Array<{
    rank: number;
    wallet: string;
    name: string;
    score: number;
    amountSol: number;
  }>;

  const top3Snapshot = getDailyTop3Internal(day);

  return {
    date: dist.day,
    poolSol: Number(dist.poolSol || 0),
    payouts: payouts.map((p) => ({
      rank: p.rank,
      wallet: p.wallet,
      name: p.name,
      score: p.score,
      amountSol: Number(p.amountSol || 0),
    })),
    payoutTxSigs: parseJsonStringArray(dist.payoutTxSigs),
    top3Snapshot,
  };
}

export function adminForceSettleDay(dayRaw: string) {
  const day = safeDayString(dayRaw);
  if (!day) return { ok: false, error: "BAD_DAY" };

  const d = ensureDay(day);

  if (d.status === "settled") {
    return { ok: true, already: true };
  }

  const top3 = getDailyTop3Internal(day);
  const n = Math.min(3, top3.length);
  const weights = DAILY.payoutWeightsTop3.slice(0, n);
  const sumW = weights.reduce((a, b) => a + b, 0);

  const payouts = top3.slice(0, n).map((p, i) => ({
    rank: i + 1,
    wallet: p.wallet,
    name: p.name,
    score: p.score,
    amountSol:
      sumW > 0 ? round6((Number(d.poolSol || 0) * weights[i]) / sumW) : 0,
  }));

  const now = nowMs();

  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM daily_payouts WHERE day=?`).run(day);

    for (const p of payouts) {
      db.prepare(
        `INSERT INTO daily_payouts(day,rank,wallet,name,score,amountSol)
         VALUES(?,?,?,?,?,?)`,
      ).run(day, p.rank, p.wallet, p.name, p.score, p.amountSol);
    }

    db.prepare(
      `INSERT OR REPLACE INTO daily_distributions(day,at,poolSol,payoutTxSigs)
       VALUES(?,?,?,NULL)`,
    ).run(day, now, Number(d.poolSol || 0));

    db.prepare(
      `UPDATE daily_days SET status='settled', settledAt=? WHERE day=?`,
    ).run(now, day);
  });

  tx();

  return { ok: true, payouts };
}

export function setDailyDistributionPayoutTxSigs(
  dayRaw: string,
  sigs: string[],
): { ok: true } | { ok: false; error: string } {
  const day = safeDayString(dayRaw);
  if (!day) return { ok: false, error: "BAD_DAY" };

  const cleaned = (sigs || [])
    .map((x) => String(x || "").trim())
    .filter(Boolean);

  db.prepare(
    `UPDATE daily_distributions
     SET payoutTxSigs=?
     WHERE day=?`,
  ).run(JSON.stringify(cleaned), day);

  return { ok: true };
}
