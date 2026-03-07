// src/server/normalLeaderboard.ts
import { db } from "./db";

export type NormalRoundStatus = "live" | "locked" | "settled";

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

/**
 * Round by id
 */
export function getRoundById(id: number): NormalRound | null {
  const rid = Math.floor(Number(id || 0));
  if (!rid) return null;

  const row = db.prepare(`SELECT * FROM normal_rounds WHERE id=?`).get(rid) as
    | NormalRound
    | undefined;

  return row ?? null;
}

/**
 * Last rounds list (for UI)
 */
export function listNormalRounds(): Array<{
  id: number;
  createdAt: number;
  status: NormalRoundStatus;
}> {
  const rows = db
    .prepare(
      `SELECT id, createdAt, status
       FROM normal_rounds
       ORDER BY id DESC
       LIMIT 200`,
    )
    .all() as Array<{
    id: number;
    createdAt: number;
    status: NormalRoundStatus;
  }>;

  return rows;
}

/**
 * Top10 for a round
 * - ORDER score desc, createdAt asc
 * - cap 3 entries per wallet
 */
export function getNormalTop10(roundId: number): NormalTopRow[] {
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
