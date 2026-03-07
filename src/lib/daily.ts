// src/lib/daily.ts

export type DailyPayout = {
  rank: number;
  wallet: string;
  name: string;
  score: number;
  amountSol: number;
};

export type DailyDistribution = {
  date: string;
  poolSol: number;
  payouts: DailyPayout[];
  payoutTxSigs?: string[];
  top3Snapshot?: Array<{ wallet: string; name: string; score: number }>;
};

export type DailyStatusResponse = {
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

export function getDailyDayForNow(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function fetchDailyStatus(
  day?: string,
): Promise<DailyStatusResponse | null> {
  const q = day ? `?day=${encodeURIComponent(day)}` : "";
  const r = await fetch(`/api/daily/status${q}`, { cache: "no-store" }).catch(
    () => null,
  );
  if (!r || !r.ok) return null;
  return (await r.json().catch(() => null)) as DailyStatusResponse | null;
}

/**
 * Submit score for the Daily tournament.
 * IMPORTANT:
 * - Must include the one-shot receipt when the run was PAID.
 * - Pool/entries are accounted for ONLY when /api/play/consume returns used === "paid".
 */
export async function saveDailyTournamentScore(args: {
  wallet: string;
  name: string;
  score: number;
  day?: string;
  startedAt: number;
  receipt?: string; // ✅ required when paid
}) {
  const payload = {
    ...args,
    day: args.day ?? getDailyDayForNow(),
  };

  const r = await fetch("/api/daily/submit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  }).catch(() => null);

  if (!r) return { ok: false as const, error: "NETWORK" };
  if (!r.ok) {
    const j = (await r.json().catch(() => null)) as { error?: string } | null;
    return { ok: false as const, error: j?.error || "SUBMIT_FAILED" };
  }
  return { ok: true as const };
}

export async function getDailyTournamentTop3(): Promise<
  Array<{ wallet: string; name: string; score: number }>
> {
  const st = await fetchDailyStatus();
  return Array.isArray(st?.top3) ? st!.top3 : [];
}

export async function getDailyTournamentPool(): Promise<number> {
  const st = await fetchDailyStatus();
  return Number(st?.day?.poolSol || 0);
}

export async function getDailyHistory(): Promise<DailyDistribution[]> {
  const r = await fetch("/api/daily/history", { cache: "no-store" }).catch(
    () => null,
  );
  if (!r || !r.ok) return [];
  const j = (await r.json().catch(() => null)) as {
    items?: DailyDistribution[];
  } | null;
  return Array.isArray(j?.items) ? j!.items : [];
}
