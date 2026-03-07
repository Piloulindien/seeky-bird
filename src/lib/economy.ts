// src/lib/economy.ts
export const ECONOMY = {
  entrySol: 0.01,
  thresholdSol: 0.5,
  take: {
    superpool: 0.05,
    marketing: 0.05,
    dev: 0.05,
    rewards: 0.85,
  },
  payoutSplitsTop10: [0.25, 0.2, 0.15, 0.1, 0.08, 0.07, 0.05, 0.04, 0.03, 0.03],
} as const;

export const PAYOUT_WEIGHTS = ECONOMY.payoutSplitsTop10;

export type Payout = {
  rank: number;
  wallet?: string;
  name: string;
  score: number;
  amountSol: number;
};

export type NormalDistribution = {
  at: number;
  poolSol: number;
  payouts: Payout[];
  top10Snapshot?: Array<{ wallet?: string; name: string; score: number }>;
  roundId?: number;
  payoutTxSigs?: string[];
};

export type NormalRound = {
  id: number;
  status: "live" | "locked" | "settled";
  createdAt: number;
  lockedAt: number | null;
  settledAt: number | null;
  poolSol: number;
  entriesCount: number;
};

export function getCurrentNormalRoundId(): number {
  return cachedStatus?.round?.id ?? 0;
}

/* ======================
   Server fetchers
====================== */

type NormalStatusResponse = {
  round: NormalRound;
  settlingRoundId: number | null;
  settleInMs: number | null;
  graceMs: number;
};

type NormalHistoryResponse = {
  items: NormalDistribution[];
  limit: number;
  offset: number;
};

let cachedStatus: NormalStatusResponse | null = null;

export async function fetchNormalStatus(): Promise<NormalStatusResponse | null> {
  const r = await fetch("/api/normal/status", { cache: "no-store" }).catch(
    () => null,
  );
  if (!r || !r.ok) return null;
  const j = (await r.json().catch(() => null)) as NormalStatusResponse | null;
  if (j?.round) cachedStatus = j;
  return j;
}

/**
 * Legacy name kept for compatibility with UI.
 * IMPORTANT: This must NOT call /api/normal/entry anymore (that would increment pool).
 * This now buys 1 paid ticket, then PlayPage will call /api/play/consume before starting.
 */

// kept for compatibility
export function lockNormalRoundIfThresholdReached() {
  // no-op (server handles lock on paid entry)
}

export async function getNormalHistory(): Promise<NormalDistribution[]> {
  const r = await fetch("/api/normal/history?limit=50&offset=0", {
    cache: "no-store",
  }).catch(() => null);
  if (!r || !r.ok) return [];
  const j = (await r.json().catch(() => null)) as NormalHistoryResponse | null;
  return Array.isArray(j?.items) ? j!.items : [];
}

export function getLastDistribution(): NormalDistribution | null {
  return null;
}
