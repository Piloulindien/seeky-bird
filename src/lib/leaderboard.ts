// src/lib/leaderboard.ts
export type ScoreEntry = {
  wallet: string;
  name: string;
  score: number;
  date?: number;
  mode?: "normal" | "daily" | "training";
  roundId?: number; // normal rounds
};

export type NormalRoundListItem = {
  id: number;
  createdAt: number;
  status: "live" | "locked" | "settled";
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

type NormalLeaderboardResponse = {
  round: NormalRound | null;
  top10: Array<{ wallet: string; name: string; score: number }>;
  rounds: NormalRoundListItem[];
};

type DailyStatusResponse = {
  day: {
    day: string;
    status: "open" | "settled";
    createdAt: number;
    settledAt: number | null;
    poolSol: number;
    entriesCount: number;
  };
  top3: Array<{ wallet: string; name: string; score: number }>;
};

export async function getAvailableNormalRounds(): Promise<number[]> {
  const r = await fetch("/api/normal/leaderboard", { cache: "no-store" }).catch(
    () => null,
  );
  if (!r || !r.ok) return [];
  const j = (await r
    .json()
    .catch(() => null)) as NormalLeaderboardResponse | null;

  const rounds = Array.isArray(j?.rounds) ? j!.rounds : [];
  const ids = rounds.map((x) => Number(x.id) || 0).filter((x) => x > 0);

  // uniq + desc
  return Array.from(new Set(ids)).sort((a, b) => b - a);
}

export async function getTop10ForRound(roundId: number) {
  const rid = Math.floor(Number(roundId) || 0);
  if (!rid) return [];

  const r = await fetch(`/api/normal/leaderboard?round=${rid}`, {
    cache: "no-store",
  }).catch(() => null);

  if (!r || !r.ok) return [];
  const j = (await r
    .json()
    .catch(() => null)) as NormalLeaderboardResponse | null;

  return Array.isArray(j?.top10) ? j.top10.slice(0, 10) : [];
}

export async function getTop3Daily(
  day?: string,
): Promise<Array<{ wallet: string; name: string; score: number }>> {
  const d = String(day || "").trim();
  const q = d ? `?day=${encodeURIComponent(d)}` : "";

  const r = await fetch(`/api/daily/status${q}`, { cache: "no-store" }).catch(
    () => null,
  );
  if (!r || !r.ok) return [];

  const j = (await r.json().catch(() => null)) as DailyStatusResponse | null;
  return Array.isArray(j?.top3) ? j!.top3.slice(0, 3) : [];
}
