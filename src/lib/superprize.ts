export type SuperPrizeEvent = {
  id: string;
  status: "live" | "frozen" | "settled";
  startAt: number;
  endAt: number;
  freezeAt: number;
  prizePoolSol: number;
  entrySol: number;
  totalEntrySol: number;
  entriesCount: number;
};

export type StatusResponse = { event: SuperPrizeEvent | null };

export type TopRow = { wallet: string; name: string; score: number };
export type Winner = {
  rank: number;
  wallet: string;
  name: string;
  score: number;
  amountSol: number;
};

function noStoreInit(): RequestInit {
  return {
    cache: "no-store",
    headers: {
      "Cache-Control": "no-store",
      Pragma: "no-cache",
    },
  };
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export async function fetchSuperprizeStatus(): Promise<StatusResponse> {
  const r = await fetch(
    `/api/superprize/status?t=${Date.now()}`,
    noStoreInit(),
  );
  const text = await r.text();
  if (!text) return { event: null };

  const u = safeJsonParse(text);
  if (!u || typeof u !== "object") return { event: null };

  const obj = u as { event?: unknown };
  const event = obj.event as SuperPrizeEvent | null | undefined;
  return { event: event ?? null };
}

export async function fetchSuperprizeLeaderboard(): Promise<{
  event: SuperPrizeEvent | null;
  top: TopRow[];
  winners: Winner[];
}> {
  const r = await fetch(
    `/api/superprize/leaderboard?t=${Date.now()}`,
    noStoreInit(),
  );

  const text = await r.text();
  if (!text) return { event: null, top: [], winners: [] };

  const u = safeJsonParse(text);
  if (!u || typeof u !== "object") return { event: null, top: [], winners: [] };

  const j = u as {
    event?: unknown;
    top?: unknown;
    winners?: unknown;
  };

  return {
    event: (j.event as SuperPrizeEvent | null | undefined) ?? null,
    top: Array.isArray(j.top) ? (j.top as TopRow[]) : [],
    winners: Array.isArray(j.winners) ? (j.winners as Winner[]) : [],
  };
}

export async function fetchSuperprizeEvent(eventId: string): Promise<{
  event: SuperPrizeEvent | null;
  top: TopRow[];
  winners: Winner[];
}> {
  const id = (eventId || "").trim();
  if (!id) return { event: null, top: [], winners: [] };

  const r = await fetch(
    `/api/superprize/event?id=${encodeURIComponent(id)}&t=${Date.now()}`,
    noStoreInit(),
  );

  const text = await r.text();
  if (!text) return { event: null, top: [], winners: [] };

  const u = safeJsonParse(text);
  if (!u || typeof u !== "object") return { event: null, top: [], winners: [] };

  const j = u as {
    event?: unknown;
    top?: unknown;
    winners?: unknown;
  };

  return {
    event: (j.event as SuperPrizeEvent | null | undefined) ?? null,
    top: Array.isArray(j.top) ? (j.top as TopRow[]) : [],
    winners: Array.isArray(j.winners) ? (j.winners as Winner[]) : [],
  };
}

export async function fetchSuperprizeLeaderboardTop3(): Promise<
  Array<{ name: string; score: number }>
> {
  const { top } = await fetchSuperprizeLeaderboard();
  return (top ?? []).slice(0, 3).map((r) => ({ name: r.name, score: r.score }));
}

export type SuperprizeSubmitArgs = {
  wallet: string;
  name: string;
  score: number;
  startedAt: number;
  receipt: string;
  seed: number;
  taps: number[];
};

export type SuperprizeSubmitOk = {
  ok: true;
  startedAt?: number;
  seed?: number;
  event?: SuperPrizeEvent | null;
};

export type SuperprizeSubmitErr = { ok: false; error: string };

export async function submitSuperprizeScore(
  args: SuperprizeSubmitArgs,
): Promise<SuperprizeSubmitOk | SuperprizeSubmitErr> {
  const r = await fetch("/api/superprize/submit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(args),
    cache: "no-store",
  }).catch(() => null);

  if (!r) return { ok: false, error: "NETWORK" };

  const j = (await r.json().catch(() => null)) as {
    ok?: boolean;
    error?: string;
    startedAt?: number;
    seed?: number;
    event?: SuperPrizeEvent | null;
  } | null;

  if (!r.ok || !j?.ok) {
    return { ok: false, error: j?.error || "SUBMIT_FAILED" };
  }

  return {
    ok: true,
    startedAt: typeof j.startedAt === "number" ? j.startedAt : undefined,
    seed: typeof j.seed === "number" ? j.seed : undefined,
    event: (j.event as SuperPrizeEvent | null | undefined) ?? undefined,
  };
}

export function isEventLive(ev: SuperPrizeEvent | null | undefined): boolean {
  return !!ev && ev.status === "live";
}

export function isEntryOpen(
  ev: SuperPrizeEvent | null | undefined,
  now = Date.now(),
): boolean {
  return !!ev && ev.status === "live" && now < ev.freezeAt;
}
