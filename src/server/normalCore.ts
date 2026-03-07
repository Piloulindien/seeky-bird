import { db, nowMs } from "./db";

export function getNormalTop10(roundId: number): NormalTopRow[] {
  return getNormalTop10Internal(roundId);
}

export type NormalRoundStatus = "live" | "locked" | "settled";

export const NORMAL = {
  entrySol: 0.01,
  thresholdSol: 0.5,
  settleGraceMs: 180_000,
  take: {
    superpool: 0.05,
    marketing: 0.05,
    dev: 0.05,
    rewards: 0.85,
  },
  payoutWeightsTop10: [
    0.25, 0.2, 0.15, 0.1, 0.08, 0.07, 0.05, 0.04, 0.03, 0.03,
  ] as const,
} as const;

export type NormalRound = {
  id: number;
  status: NormalRoundStatus;
  createdAt: number;
  lockedAt: number | null;
  settledAt: number | null;
  poolSol: number;
  entriesCount: number;
};

export type NormalTopRow = {
  wallet: string;
  name: string;
  score: number;
};

export type NormalPayoutRow = {
  rank: number;
  wallet: string;
  name: string;
  score: number;
  amountSol: number;
};

export type NormalDistribution = {
  at: number;
  poolSol: number;
  payouts: NormalPayoutRow[];
  top10Snapshot: NormalTopRow[];
  roundId: number;
  payoutTxSigs?: string[];
};

function round6(n: number) {
  return Math.round(n * 1_000_000) / 1_000_000;
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

export function getRoundById(id: number): NormalRound | null {
  const rid = Math.floor(Number(id || 0));
  if (!rid) return null;

  const row = db.prepare(`SELECT * FROM normal_rounds WHERE id=?`).get(rid) as
    | NormalRound
    | undefined;

  return row ?? null;
}

function getCurrentRound(): NormalRound {
  settleLockedRoundsIfReady();

  const row = db
    .prepare(
      `SELECT * FROM normal_rounds
       WHERE status IN ('live','locked')
       ORDER BY id DESC
       LIMIT 1`,
    )
    .get() as NormalRound | undefined;

  if (row) return row;

  const t = nowMs();
  const ins = db
    .prepare(
      `INSERT INTO normal_rounds(status,createdAt,poolSol,entriesCount)
       VALUES('live',?,?,0)`,
    )
    .run(t, 0);

  const id = Number(ins.lastInsertRowid);
  return getRoundById(id)!;
}

export function getNormalStatus(): {
  round: NormalRound;
  settlingRoundId: number | null;
  settleInMs: number | null;
  graceMs: number;
} {
  const cur = getCurrentRound();

  const pending = db
    .prepare(
      `SELECT id, lockedAt
       FROM normal_rounds
       WHERE status='locked' AND settledAt IS NULL
       ORDER BY lockedAt ASC
       LIMIT 1`,
    )
    .get() as { id: number; lockedAt: number } | undefined;

  if (!pending?.lockedAt) {
    return {
      round: cur,
      settlingRoundId: null,
      settleInMs: null,
      graceMs: NORMAL.settleGraceMs,
    };
  }

  const now = nowMs();
  const settleInMs = Math.max(
    0,
    NORMAL.settleGraceMs - (now - pending.lockedAt),
  );

  return {
    round: cur,
    settlingRoundId: pending.id,
    settleInMs,
    graceMs: NORMAL.settleGraceMs,
  };
}

function lockAndRoll(round: NormalRound) {
  if (round.status !== "live") return;

  const t = nowMs();
  const carry = Number(
    Math.max(0, round.poolSol - NORMAL.thresholdSol).toFixed(4),
  );

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE normal_rounds
       SET status='locked', lockedAt=?, poolSol=?
       WHERE id=?`,
    ).run(t, NORMAL.thresholdSol, round.id);

    db.prepare(
      `INSERT INTO normal_rounds(status,createdAt,poolSol,entriesCount)
       VALUES('live',?,?,0)`,
    ).run(t, carry);
  });

  tx();
}

export function recordNormalEntry(): { ok: true; round: NormalRound } {
  const cur = getCurrentRound();

  const rewards = NORMAL.entrySol * NORMAL.take.rewards;
  const nextPool = Number((cur.poolSol + rewards).toFixed(4));

  db.prepare(
    `UPDATE normal_rounds
     SET poolSol=?, entriesCount=entriesCount+1
     WHERE id=?`,
  ).run(nextPool, cur.id);

  const updated = getRoundById(cur.id)!;

  if (updated.status === "live" && updated.poolSol >= NORMAL.thresholdSol) {
    lockAndRoll(updated);
  }

  return { ok: true, round: updated };
}

export function submitNormalScore(args: {
  wallet: string;
  name: string;
  score: number;
  startedAt: number;
  roundId: number;
}): { ok: true } | { ok: false; error: string } {
  const wallet = String(args.wallet || "").trim();
  const name = String(args.name || "").trim();
  const score = Math.max(0, Math.floor(Number(args.score || 0)));
  const startedAt = Math.floor(Number(args.startedAt || 0));
  const roundId = Math.floor(Number(args.roundId || 0));

  if (!wallet || wallet.length < 8) return { ok: false, error: "BAD_WALLET" };
  if (!name || name.length < 2) return { ok: false, error: "BAD_NAME" };
  if (!startedAt) return { ok: false, error: "BAD_STARTED_AT" };
  if (!roundId) return { ok: false, error: "BAD_ROUND" };

  const round = getRoundById(roundId);
  if (!round) return { ok: false, error: "ROUND_NOT_FOUND" };

  if (round.status !== "live" && round.lockedAt && startedAt > round.lockedAt) {
    return { ok: false, error: "STARTED_AFTER_LOCK" };
  }

  if (round.status !== "live" && round.lockedAt) {
    const t = nowMs();
    if (t > round.lockedAt + NORMAL.settleGraceMs) {
      return { ok: false, error: "ROUND_CLOSED" };
    }
  }

  const u = ensureUser(wallet, name);
  if (!u.ok) return u;

  db.prepare(
    `INSERT INTO normal_entries(roundId,wallet,name,score,startedAt,createdAt)
     VALUES(?,?,?,?,?,?)`,
  ).run(roundId, wallet, name, score, startedAt, nowMs());

  settleLockedRoundsIfReady();

  return { ok: true };
}

export function getNormalHistory(
  limit = 50,
  offset = 0,
): { items: NormalDistribution[]; limit: number; offset: number } {
  settleLockedRoundsIfReady();

  const l = Math.min(200, Math.max(1, Math.floor(limit)));
  const o = Math.max(0, Math.floor(offset));

  const dists = db
    .prepare(
      `SELECT roundId, at, poolSol, payoutTxSigs
       FROM normal_distributions
       ORDER BY at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(l, o) as Array<{
    roundId: number;
    at: number;
    poolSol: number;
    payoutTxSigs: string | null;
  }>;

  const pStmt = db.prepare(
    `SELECT rank, wallet, name, score, amountSol
     FROM normal_payouts
     WHERE roundId=?
     ORDER BY rank ASC`,
  );

  const items: NormalDistribution[] = dists.map((d) => {
    const payouts = pStmt.all(d.roundId) as NormalPayoutRow[];
    const top10 = getNormalTop10Internal(d.roundId);
    const payoutTxSigs = parseJsonStringArray(d.payoutTxSigs);

    return {
      at: d.at,
      poolSol: d.poolSol,
      payouts,
      top10Snapshot: top10,
      roundId: d.roundId,
      payoutTxSigs,
    };
  });

  return { items, limit: l, offset: o };
}

function getNormalTop10Internal(roundId: number): NormalTopRow[] {
  const rid = Math.floor(Number(roundId || 0));
  if (!rid) return [];

  const rows = db
    .prepare(
      `SELECT wallet, name, score, createdAt
       FROM normal_entries
       WHERE roundId=?
       ORDER BY score DESC, createdAt ASC`,
    )
    .all(rid) as Array<{
    wallet: string;
    name: string;
    score: number;
    createdAt: number;
  }>;

  const out: NormalTopRow[] = [];
  const seen = new Map<string, number>();

  for (const r of rows) {
    const cur = seen.get(r.wallet) || 0;
    if (cur >= 3) continue;
    seen.set(r.wallet, cur + 1);
    out.push({ wallet: r.wallet, name: r.name, score: r.score });
    if (out.length >= 10) break;
  }

  return out;
}

function settleLockedRoundsIfReady() {
  const now = nowMs();

  const pending = db
    .prepare(
      `SELECT * FROM normal_rounds
       WHERE status='locked' AND settledAt IS NULL
       ORDER BY lockedAt ASC
       LIMIT 50`,
    )
    .all() as NormalRound[];

  for (const r of pending) {
    if (!r.lockedAt) continue;
    if (now - r.lockedAt < NORMAL.settleGraceMs) continue;

    const top10 = getNormalTop10Internal(r.id);
    const n = Math.min(10, top10.length);
    const weights = NORMAL.payoutWeightsTop10.slice(0, n);
    const sumW = weights.reduce((a, b) => a + b, 0);

    const payouts: NormalPayoutRow[] = top10.slice(0, n).map((p, i) => ({
      rank: i + 1,
      wallet: p.wallet,
      name: p.name,
      score: p.score,
      amountSol: round6(r.poolSol * (weights[i] / sumW)),
    }));

    const tx = db.transaction(() => {
      db.prepare(`DELETE FROM normal_payouts WHERE roundId=?`).run(r.id);

      for (const p of payouts) {
        db.prepare(
          `INSERT INTO normal_payouts(roundId,rank,wallet,name,score,amountSol)
           VALUES(?,?,?,?,?,?)`,
        ).run(r.id, p.rank, p.wallet, p.name, p.score, p.amountSol);
      }

      db.prepare(
        `INSERT OR REPLACE INTO normal_distributions(roundId,at,poolSol,payoutTxSigs)
         VALUES(?,?,?,COALESCE((SELECT payoutTxSigs FROM normal_distributions WHERE roundId=?), NULL))`,
      ).run(r.id, now, r.poolSol, r.id);

      db.prepare(
        `UPDATE normal_rounds
         SET status='settled', settledAt=?
         WHERE id=?`,
      ).run(now, r.id);
    });

    tx();
  }
}

export function getNormalDistributionByRound(
  roundId: number,
): NormalDistribution | null {
  const rid = Math.floor(Number(roundId || 0));
  if (!rid) return null;

  const dist = db
    .prepare(
      `SELECT roundId, at, poolSol, payoutTxSigs
       FROM normal_distributions
       WHERE roundId=?`,
    )
    .get(rid) as
    | {
        roundId: number;
        at: number;
        poolSol: number;
        payoutTxSigs: string | null;
      }
    | undefined;

  if (!dist) return null;

  const payouts = db
    .prepare(
      `SELECT rank, wallet, name, score, amountSol
       FROM normal_payouts
       WHERE roundId=?
       ORDER BY rank ASC`,
    )
    .all(rid) as NormalPayoutRow[];

  const top10Snapshot = getNormalTop10Internal(rid);

  return {
    at: dist.at,
    poolSol: dist.poolSol,
    payouts,
    top10Snapshot,
    roundId: dist.roundId,
    payoutTxSigs: parseJsonStringArray(dist.payoutTxSigs),
  };
}

export function setNormalDistributionPayoutTxSigs(
  roundId: number,
  sigs: string[],
): { ok: true } | { ok: false; error: string } {
  const rid = Math.floor(Number(roundId || 0));
  if (!rid) return { ok: false, error: "BAD_ROUND_ID" };

  const cleaned = (sigs || [])
    .map((x) => String(x || "").trim())
    .filter(Boolean);

  db.prepare(
    `UPDATE normal_distributions
     SET payoutTxSigs=?
     WHERE roundId=?`,
  ).run(JSON.stringify(cleaned), rid);

  return { ok: true };
}
