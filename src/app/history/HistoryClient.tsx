"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/* ======================
 Tabs
====================== */

type Tab = "normal" | "daily" | "superprize";

function parseTab(v: string | null): Tab {
  if (v === "normal") return "normal";
  if (v === "superprize") return "superprize";
  return "daily";
}

function parseEventId(v: string | null): string {
  return String(v || "").trim();
}

function fmtDT(ms: number): string {
  if (!ms) return "";
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return "";
  }
}

/* ======================
 Types
====================== */

type DailyDistribution = {
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
  top3Snapshot?: Array<{ wallet: string; name: string; score: number }>;
};

type DailyHistoryResponse = {
  ok: boolean;
  items: DailyDistribution[];
  limit: number;
  offset: number;
};

type NormalDistribution = {
  at: number;
  poolSol: number;
  payouts: Array<{
    rank: number;
    wallet: string;
    name: string;
    score: number;
    amountSol: number;
  }>;
  top10Snapshot: Array<{ wallet: string; name: string; score: number }>;
  roundId: number;
  payoutTxSigs?: string[];
};

type NormalHistoryResponse = {
  items: NormalDistribution[];
  limit: number;
  offset: number;
};

/* ======================
 SuperPrize types (API)
====================== */

type SpStatus = "live" | "frozen" | "settled";

type SpEvent = {
  id: string;
  status: SpStatus;
  endAt: number;
  prizePoolSol: number;
  entrySol: number;
  payoutTxSigs?: string[];
};

type SpArchiveItem = {
  event: SpEvent;
  winners: Array<{
    rank: number;
    wallet: string;
    name: string;
    score: number;
    amountSol: number;
  }>;
};

type SpArchiveResponse = {
  items: SpArchiveItem[];
  limit: number;
  offset: number;
};

type SpEventResponse = {
  event: SpEvent | null;
  top: Array<{ wallet: string; name: string; score: number }>;
  winners: Array<{
    rank: number;
    wallet: string;
    name: string;
    score: number;
    amountSol: number;
  }>;
};

/* ======================
 Helpers
====================== */

function safeNum(x: unknown, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

function asArray<T = unknown>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

/* ======================
 Page
====================== */

const PAGE_LIMIT = 20;

export default function HistoryClient() {
  const router = useRouter();
  const sp = useSearchParams();

  const [mounted, setMounted] = useState(false);

  const tab = useMemo(() => parseTab(sp.get("tab")), [sp]);
  const urlEventId = useMemo(() => parseEventId(sp.get("eventId")), [sp]);

  // Normal/Daily lists + pagination
  const [daily, setDaily] = useState<DailyDistribution[]>([]);
  const [dailyToday, setDailyToday] = useState<{
    day: string;
    poolSol: number;
    top3: Array<{ wallet: string; name: string; score: number }>;
  } | null>(null);

  const [dailyTodayLoading, setDailyTodayLoading] = useState(false);
  const [normal, setNormal] = useState<NormalDistribution[]>([]);
  const [loadingHist, setLoadingHist] = useState(false);

  const [dailyOffset, setDailyOffset] = useState(0);
  const [normalOffset, setNormalOffset] = useState(0);

  const [dailyHasMore, setDailyHasMore] = useState(true);
  const [normalHasMore, setNormalHasMore] = useState(true);

  // mount
  useEffect(() => {
    if (typeof window === "undefined") return;
    setMounted(true);
  }, []);

  // reset paging when switching tab
  useEffect(() => {
    if (!mounted) return;

    if (tab === "daily") {
      setDaily([]);
      setDailyOffset(0);
      setDailyHasMore(true);
    }
    if (tab === "normal") {
      setNormal([]);
      setNormalOffset(0);
      setNormalHasMore(true);
    }
  }, [mounted, tab]);

  async function loadDailyPage(nextOffset: number) {
    const r = await fetch(
      `/api/daily/history?limit=${PAGE_LIMIT}&offset=${nextOffset}`,
      { cache: "no-store" },
    ).catch(() => null);

    if (!r || !r.ok) return null;

    const j = (await r.json().catch(() => null)) as DailyHistoryResponse | null;
    if (!j?.ok) return null;

    const items = asArray<DailyDistribution>(j.items);
    return {
      items,
      limit: safeNum(j.limit, PAGE_LIMIT),
      offset: safeNum(j.offset, nextOffset),
    };
  }

  async function loadNormalPage(nextOffset: number) {
    const r = await fetch(
      `/api/normal/history?limit=${PAGE_LIMIT}&offset=${nextOffset}`,
      { cache: "no-store" },
    ).catch(() => null);

    if (!r || !r.ok) return null;

    const j = (await r
      .json()
      .catch(() => null)) as NormalHistoryResponse | null;
    const items = asArray<NormalDistribution>(j?.items);

    return {
      items,
      limit: safeNum(j?.limit, PAGE_LIMIT),
      offset: safeNum(j?.offset, nextOffset),
    };
  }

  // fetch first page for daily/normal
  useEffect(() => {
    if (!mounted) return;
    if (tab === "superprize") return;

    let alive = true;

    const run = async () => {
      setLoadingHist(true);
      try {
        if (tab === "daily") {
          const res = await loadDailyPage(0);
          if (!alive) return;

          const items = res?.items ?? [];
          setDaily(items);
          setDailyOffset(items.length);
          setDailyHasMore(items.length >= PAGE_LIMIT);
        }

        if (tab === "normal") {
          const res = await loadNormalPage(0);
          if (!alive) return;

          const items = res?.items ?? [];
          setNormal(items);
          setNormalOffset(items.length);
          setNormalHasMore(items.length >= PAGE_LIMIT);
        }
      } finally {
        if (alive) setLoadingHist(false);
      }
    };

    void run();
    return () => {
      alive = false;
    };
  }, [mounted, tab]);

  // Daily: fetch today's live status
  useEffect(() => {
    if (!mounted) return;

    let alive = true;
    setDailyTodayLoading(true);

    const run = async () => {
      try {
        const r = await fetch("/api/daily/status", { cache: "no-store" }).catch(
          () => null,
        );
        if (!alive) return;

        if (!r || !r.ok) {
          setDailyToday(null);
          return;
        }

        const j = (await r.json().catch(() => null)) as {
          day?: { day?: string; poolSol?: number };
          top3?: Array<{ wallet: string; name: string; score: number }>;
        } | null;

        const day = String(j?.day?.day || "").trim();
        const poolSol = Number(j?.day?.poolSol || 0);
        const top3 = Array.isArray(j?.top3) ? j.top3 : [];

        if (day) {
          setDailyToday({ day, poolSol, top3 });
        } else {
          setDailyToday(null);
        }
      } finally {
        if (alive) setDailyTodayLoading(false);
      }
    };

    void run();
    const t = window.setInterval(run, 4000);

    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [mounted]);

  /* ---------------- SuperPrize list + selected event details --------------- */

  const [spEvents, setSpEvents] = useState<SpEvent[]>([]);
  const [spLoadingList, setSpLoadingList] = useState(false);

  const [spLoadingEvent, setSpLoadingEvent] = useState(false);
  const [spTop3, setSpTop3] = useState<Array<{ name: string; score: number }>>(
    [],
  );
  const [spWinners, setSpWinners] = useState<
    Array<{ rank: number; name: string; score: number; amountSol: number }>
  >([]);
  const [spMeta, setSpMeta] = useState<SpEvent | null>(null);
  const [spPayoutTxSigs, setSpPayoutTxSigs] = useState<string[]>([]);

  // Fetch events list (live/frozen + archives)
  useEffect(() => {
    if (!mounted) return;

    let cancelled = false;
    setSpLoadingList(true);

    const run = async () => {
      const [cur, arc] = await Promise.all([
        fetch("/api/superprize/leaderboard", { cache: "no-store" })
          .then((r) => (r.ok ? (r.json() as Promise<SpEventResponse>) : null))
          .catch(() => null),
        fetch("/api/superprize/archive?limit=50&offset=0", {
          cache: "no-store",
        })
          .then((r) => (r.ok ? (r.json() as Promise<SpArchiveResponse>) : null))
          .catch(() => null),
      ]);

      if (cancelled) return;

      const liveOrFrozen = cur?.event ? [cur.event] : [];
      const settled = (arc?.items ?? []).map((it) => it.event);

      const byId = new Map<string, SpEvent>();
      for (const ev of [...liveOrFrozen, ...settled]) {
        if (!ev?.id) continue;
        if (!byId.has(ev.id)) byId.set(ev.id, ev);
      }

      const arr = Array.from(byId.values()).sort(
        (a, b) => (b.endAt || 0) - (a.endAt || 0),
      );

      setSpEvents(arr);
      setSpLoadingList(false);
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [mounted]);

  const effectiveEventId = useMemo(() => {
    if (tab !== "superprize") return "";
    if (urlEventId) return urlEventId;
    return spEvents.length ? spEvents[0].id : "";
  }, [tab, urlEventId, spEvents]);

  const selectedEvent = useMemo(() => {
    if (!effectiveEventId) return null;
    return spEvents.find((e) => e.id === effectiveEventId) || null;
  }, [spEvents, effectiveEventId]);

  const superLabel = useMemo(() => {
    if (!effectiveEventId) return "SuperPrize";
    const idx = spEvents.findIndex((e) => e.id === effectiveEventId);
    const base = idx === -1 ? "SuperPrize" : `SuperPrize #${idx + 1}`;
    const ends = selectedEvent?.endAt ? fmtDT(selectedEvent.endAt) : "";
    return ends ? `${base} · ends ${ends}` : base;
  }, [spEvents, effectiveEventId, selectedEvent]);

  // Keep URL eventId filled when opening SuperPrize tab
  useEffect(() => {
    if (!mounted) return;
    if (tab !== "superprize") return;
    if (!effectiveEventId) return;

    if (sp.get("eventId") === effectiveEventId) return;

    const q = new URLSearchParams(sp.toString());
    q.set("tab", "superprize");
    q.set("eventId", effectiveEventId);

    router.replace(`/history?${q.toString()}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, tab, effectiveEventId]);

  // Fetch details for selected event
  useEffect(() => {
    if (!mounted) return;
    if (tab !== "superprize") return;

    let cancelled = false;

    if (!effectiveEventId) {
      setSpMeta(null);
      setSpTop3([]);
      setSpWinners([]);
      setSpPayoutTxSigs([]);
      return () => {
        cancelled = true;
      };
    }

    setSpLoadingEvent(true);

    const run = async () => {
      const r = await fetch(
        `/api/superprize/event?id=${encodeURIComponent(effectiveEventId)}`,
        { cache: "no-store" },
      ).catch(() => null);

      if (!r || !r.ok) {
        if (!cancelled) setSpLoadingEvent(false);
        return;
      }

      const j = (await r.json().catch(() => null)) as SpEventResponse | null;
      if (cancelled) return;

      const ev = j?.event ?? null;
      const top = Array.isArray(j?.top) ? j.top : [];
      const winners = Array.isArray(j?.winners) ? j.winners : [];

      setSpMeta(ev);
      setSpTop3(top.slice(0, 3).map((x) => ({ name: x.name, score: x.score })));
      setSpWinners(
        winners
          .slice(0, 3)
          .map((w) => ({
            rank: w.rank,
            name: w.name,
            score: w.score,
            amountSol: w.amountSol,
          }))
          .sort((a, b) => a.rank - b.rank),
      );
      setSpPayoutTxSigs(Array.isArray(ev?.payoutTxSigs) ? ev.payoutTxSigs : []);

      setSpLoadingEvent(false);
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [mounted, tab, effectiveEventId]);

  /* ---------------- URL writers (tabs + select) ---------------- */

  const setTabUrl = (next: Tab) => {
    const q = new URLSearchParams(sp.toString());
    q.set("tab", next);
    if (next !== "superprize") q.delete("eventId");
    router.replace(`/history?${q.toString()}`);
  };

  const setEventUrl = (id: string) => {
    const q = new URLSearchParams(sp.toString());
    q.set("tab", "superprize");
    if (id) q.set("eventId", id);
    else q.delete("eventId");
    router.replace(`/history?${q.toString()}`);
  };

  /* ---------------- Actions: load more ---------------- */

  const loadMoreDaily = async () => {
    if (loadingHist || !dailyHasMore) return;
    setLoadingHist(true);
    try {
      const res = await loadDailyPage(dailyOffset);
      const items = res?.items ?? [];
      setDaily((prev) => [...prev, ...items]);
      setDailyOffset((prev) => prev + items.length);
      setDailyHasMore(items.length >= PAGE_LIMIT);
    } finally {
      setLoadingHist(false);
    }
  };

  const loadMoreNormal = async () => {
    if (loadingHist || !normalHasMore) return;
    setLoadingHist(true);
    try {
      const res = await loadNormalPage(normalOffset);
      const items = res?.items ?? [];
      setNormal((prev) => [...prev, ...items]);
      setNormalOffset((prev) => prev + items.length);
      setNormalHasMore(items.length >= PAGE_LIMIT);
    } finally {
      setLoadingHist(false);
    }
  };

  /* ---------------- Render ---------------- */

  return (
    <main style={wrap}>
      <div style={shell}>
        <div style={{ marginBottom: 12 }}>
          <Link href="/" style={homeBtn}>
            ⬅ Home
          </Link>
        </div>

        <h1 style={h1}>📜 History</h1>

        <div style={tabs}>
          <button
            style={{ ...tabBtn, opacity: tab === "normal" ? 1 : 0.65 }}
            onClick={() => setTabUrl("normal")}
          >
            Normal
          </button>
          <button
            style={{ ...tabBtn, opacity: tab === "daily" ? 1 : 0.65 }}
            onClick={() => setTabUrl("daily")}
          >
            Daily
          </button>
          <button
            style={{ ...tabBtn, opacity: tab === "superprize" ? 1 : 0.65 }}
            onClick={() => setTabUrl("superprize")}
          >
            SuperPrize
          </button>
        </div>

        {loadingHist && tab !== "superprize" && <Muted>Loading…</Muted>}

        {/* NORMAL */}
        {tab === "normal" && (
          <div style={card}>
            <div style={cardHeader}>
              <div style={cardHeaderText}>
                <div style={{ fontWeight: 900 }}>
                  Normal Mode (payout history)
                </div>
                <div style={scopeText}>
                  Click an item to open the leaderboard round.
                </div>
              </div>
            </div>

            {normal.length === 0 ? (
              <Muted>No normal distributions yet.</Muted>
            ) : (
              <div style={cardList}>
                {normal.map((d) => (
                  <DistributionCard
                    key={`normal-${d.roundId}-${d.at}`}
                    label={new Date(d.at).toLocaleString()}
                    poolSol={d.poolSol}
                    payouts={d.payouts}
                    payoutTxSigs={d.payoutTxSigs}
                    onClick={() => {
                      const rid = Number(d.roundId) || 0;
                      if (rid)
                        router.push(`/leaderboard?tab=normal&round=${rid}`);
                    }}
                    top10Snapshot={d.top10Snapshot}
                  />
                ))}
              </div>
            )}

            {normalHasMore && (
              <button
                style={openBtn}
                onClick={loadMoreNormal}
                disabled={loadingHist}
              >
                {loadingHist ? "Loading…" : "Load more"}
              </button>
            )}
          </div>
        )}

        {/* DAILY */}
        {tab === "daily" && (
          <div style={card}>
            <div style={cardHeader}>
              <div style={cardHeaderText}>
                <div style={{ fontWeight: 900 }}>Daily Tournament</div>
                <div style={scopeText}>
                  Today (open) + settled archives (payouts).
                </div>
              </div>
            </div>

            {dailyTodayLoading ? (
              <Muted>Loading today…</Muted>
            ) : dailyToday ? (
              <div style={{ marginBottom: 12 }}>
                <DistributionCard
                  label={`Today (open) · ${dailyToday.day}`}
                  poolSol={Number(dailyToday.poolSol || 0)}
                  payouts={[]}
                  payoutTxSigs={[]}
                  top3Snapshot={dailyToday.top3.map((x) => ({
                    name: x.name,
                    score: x.score,
                  }))}
                  onClick={() =>
                    router.push(
                      `/leaderboard?tab=daily&day=${encodeURIComponent(dailyToday.day)}`,
                    )
                  }
                />
              </div>
            ) : null}

            {daily.length === 0 ? (
              <Muted>No settled daily distributions yet.</Muted>
            ) : (
              <div style={cardList}>
                {daily.map((d) => (
                  <DistributionCard
                    key={`daily-${d.date}`}
                    label={`Settled · ${d.date}`}
                    poolSol={d.poolSol}
                    payouts={d.payouts}
                    payoutTxSigs={d.payoutTxSigs}
                    onClick={() =>
                      router.push(
                        `/leaderboard?tab=daily&day=${encodeURIComponent(d.date)}`,
                      )
                    }
                    top3Snapshot={d.top3Snapshot?.map((x) => ({
                      name: x.name,
                      score: x.score,
                    }))}
                  />
                ))}
              </div>
            )}

            {dailyHasMore && (
              <button
                style={openBtn}
                onClick={loadMoreDaily}
                disabled={loadingHist}
              >
                {loadingHist ? "Loading…" : "Load more"}
              </button>
            )}
          </div>
        )}

        {/* SUPERPRIZE */}
        {tab === "superprize" && (
          <div style={card}>
            <div style={cardHeader}>
              <div style={cardHeaderText}>
                <div style={{ fontWeight: 900 }}>{superLabel}</div>
                <div style={scopeText}>
                  Select an event. Shows Top 3 + payouts Top 3.
                </div>
              </div>

              <select
                value={effectiveEventId || ""}
                onChange={(e) => setEventUrl(String(e.target.value || ""))}
                style={select}
              >
                {!spEvents.length && (
                  <option value="">
                    {spLoadingList ? "Loading..." : "No events"}
                  </option>
                )}
                {spEvents.map((ev, i) => (
                  <option key={ev.id} value={ev.id}>
                    SuperPrize #{i + 1}
                    {ev.endAt ? ` · ends ${fmtDT(ev.endAt)}` : ""}
                  </option>
                ))}
              </select>
            </div>

            {spLoadingEvent ? (
              <Muted>Loading…</Muted>
            ) : !effectiveEventId ? (
              <Muted>No event selected.</Muted>
            ) : (
              <>
                {spMeta && (
                  <div style={meta}>
                    Prize:{" "}
                    <b>{Number(spMeta.prizePoolSol || 0).toFixed(3)} SOL</b> ·
                    Entry: <b>{Number(spMeta.entrySol || 0).toFixed(3)} SOL</b>{" "}
                    · Status: <b>{spMeta.status}</b>
                    {spMeta.endAt ? (
                      <>
                        {" "}
                        · Ends: <b>{fmtDT(spMeta.endAt)}</b>
                      </>
                    ) : null}
                  </div>
                )}

                <div style={{ marginTop: 10 }}>
                  <div style={sectionTitle}>Top 3</div>

                  {spTop3.length === 0 ? (
                    <Muted>No scores.</Muted>
                  ) : (
                    <div style={list}>
                      {spTop3.slice(0, 3).map((p, idx) => (
                        <div key={`${p.name}-${p.score}-${idx}`} style={row}>
                          <span style={rowMain}>
                            #{idx + 1} <b>{p.name}</b>
                          </span>
                          <span style={rowAside}>{p.score}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{ marginTop: 12 }}>
                  <div style={sectionTitle}>Payouts (Top 3)</div>

                  {spWinners.length === 0 ? (
                    <Muted>No payouts.</Muted>
                  ) : (
                    <div style={list}>
                      {spWinners.slice(0, 3).map((w) => (
                        <div key={`w-${w.rank}-${w.name}`} style={row}>
                          <span style={rowMain}>
                            #{w.rank} <b>{w.name}</b> ({w.score})
                          </span>
                          <span style={rowAside}>
                            {Number(w.amountSol || 0).toFixed(4)} SOL
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <TxSection sigs={spPayoutTxSigs} />

                <div style={{ marginTop: 12 }}>
                  <button
                    style={openBtn}
                    onClick={() =>
                      router.push(
                        `/leaderboard?tab=superprize&eventId=${encodeURIComponent(
                          effectiveEventId,
                        )}`,
                      )
                    }
                  >
                    Open in Leaderboards →
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

/* ======================
 Components
====================== */

function DistributionCard(props: {
  label: string;
  poolSol: number;
  payouts: Array<{
    rank: number;
    name: string;
    score: number;
    amountSol: number;
  }>;
  onClick?: () => void;
  top10Snapshot?: Array<{ name: string; score: number }>;
  top3Snapshot?: Array<{ name: string; score: number }>;
  payoutTxSigs?: string[];
}) {
  const clickable = Boolean(props.onClick);

  return (
    <div
      style={{ ...distCard, cursor: clickable ? "pointer" : "default" }}
      onClick={props.onClick}
      role={clickable ? "link" : undefined}
      tabIndex={clickable ? 0 : -1}
      onKeyDown={(e) => {
        if (!clickable) return;
        if (e.key === "Enter" || e.key === " ") props.onClick?.();
      }}
    >
      <div style={cardTitleRow}>
        <div style={cardTitle}>{props.label}</div>
        {clickable && <div style={pillLinkHint}>View →</div>}
      </div>

      <div style={meta}>
        Pool: <b>{Number(props.poolSol || 0).toFixed(3)} SOL</b>
      </div>

      {props.payouts.length === 0 ? (
        <Muted>No payouts</Muted>
      ) : (
        <div style={list}>
          {props.payouts.map((p) => (
            <div key={`${p.rank}-${p.name}`} style={row}>
              <span style={rowMain}>
                #{p.rank} <b>{p.name}</b> ({p.score})
              </span>
              <span style={rowAside}>{p.amountSol.toFixed(4)} SOL</span>
            </div>
          ))}
        </div>
      )}

      <TxSection sigs={props.payoutTxSigs ?? []} />

      {!!props.top3Snapshot?.length && (
        <div style={{ marginTop: 10 }}>
          <div style={sectionTitle}>Top 3 (snapshot)</div>
          <div style={listCompact}>
            {props.top3Snapshot.slice(0, 3).map((s, i) => (
              <div key={`${i}-${s.name}-${s.score}`} style={snapshotRow}>
                <span style={rowMain}>
                  #{i + 1} <b>{s.name}</b>
                </span>
                <span style={rowAside}>{s.score}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {!!props.top10Snapshot?.length && (
        <div style={{ marginTop: 10 }}>
          <div style={sectionTitle}>Top 10 (snapshot at payout)</div>

          <div style={listCompact}>
            {props.top10Snapshot.slice(0, 10).map((s, i) => (
              <div key={`${i}-${s.name}-${s.score}`} style={snapshotRow}>
                <span style={rowMain}>
                  #{i + 1} <b>{s.name}</b>
                </span>
                <span style={rowAside}>{s.score}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TxSection({ sigs }: { sigs: string[] }) {
  if (!sigs?.length) {
    return <div style={txMuted}>Payout tx: —</div>;
  }

  return (
    <div style={{ marginTop: 10 }}>
      <div style={sectionTitle}>Payout tx</div>

      <div style={listCompact}>
        {sigs.map((sig) => {
          const short = `${sig.slice(0, 8)}…${sig.slice(-8)}`;
          return (
            <a
              key={sig}
              href={`https://solscan.io/tx/${sig}`}
              target="_blank"
              rel="noreferrer"
              style={txRow}
              onClick={(e) => e.stopPropagation()}
              title={sig}
            >
              <span style={txBtn}>View</span>
              <span style={txSig}>{short}</span>
            </a>
          );
        })}
      </div>
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <div style={muted}>{children}</div>;
}

/* ======================
 Styles
====================== */

const wrap: React.CSSProperties = {
  minHeight: "100vh",
  background: "#020617",
  color: "white",
  padding: 16,
  fontFamily: "system-ui",
  overflowX: "hidden",
};

const shell: React.CSSProperties = {
  width: "min(920px, 100%)",
  margin: "0 auto",
};

const h1: React.CSSProperties = {
  fontSize: 26,
  margin: "14px 0",
};

const tabs: React.CSSProperties = {
  display: "flex",
  gap: 10,
  marginBottom: 12,
  flexWrap: "wrap",
};

const tabBtn: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.2)",
  background: "rgba(255,255,255,0.06)",
  color: "white",
  cursor: "pointer",
  fontWeight: 900,
  flex: "1 1 120px",
  minHeight: 42,
};

const card: React.CSSProperties = {
  padding: 12,
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.15)",
  background: "rgba(255,255,255,0.06)",
};

const cardHeader: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 10,
  alignItems: "stretch",
  flexWrap: "wrap",
  marginBottom: 6,
};

const cardHeaderText: React.CSSProperties = {
  minWidth: 0,
  flex: "1 1 220px",
};

const cardList: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 12,
};

const scopeText: React.CSSProperties = {
  marginTop: 4,
  fontSize: 13,
  opacity: 0.82,
  lineHeight: 1.35,
  overflowWrap: "anywhere",
};

const distCard: React.CSSProperties = {
  padding: 12,
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.15)",
  background: "rgba(255,255,255,0.06)",
  overflow: "hidden",
};

const cardTitleRow: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 10,
  marginBottom: 4,
  flexWrap: "wrap",
};

const cardTitle: React.CSSProperties = {
  fontWeight: 800,
  minWidth: 0,
  overflowWrap: "anywhere",
};

const pillLinkHint: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 800,
  opacity: 0.8,
  padding: "6px 10px",
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(255,255,255,0.04)",
  whiteSpace: "nowrap",
};

const meta: React.CSSProperties = {
  opacity: 0.85,
  marginBottom: 8,
  lineHeight: 1.35,
  overflowWrap: "anywhere",
};

const list: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const listCompact: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const row: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 10,
  padding: "8px 10px",
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.03)",
};

const snapshotRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 10,
  padding: "8px 10px",
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.02)",
  opacity: 0.95,
};

const rowMain: React.CSSProperties = {
  minWidth: 0,
  overflowWrap: "anywhere",
};

const rowAside: React.CSSProperties = {
  flexShrink: 0,
  textAlign: "right",
  fontWeight: 900,
};

const muted: React.CSSProperties = {
  opacity: 0.7,
  padding: "6px 0",
  lineHeight: 1.35,
};

const select: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.18)",
  background: "rgba(255,255,255,0.06)",
  color: "white",
  width: "100%",
  flex: "1 1 260px",
  minHeight: 42,
  minWidth: 0,
};

const openBtn: React.CSSProperties = {
  width: "100%",
  padding: "12px 12px",
  minHeight: 42,
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.18)",
  background: "rgba(255,255,255,0.06)",
  color: "white",
  cursor: "pointer",
  fontWeight: 900,
  marginTop: 12,
};

const homeBtn: React.CSSProperties = {
  display: "inline-block",
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.2)",
  background: "rgba(255,255,255,0.06)",
  color: "white",
  textDecoration: "none",
  fontWeight: 700,
};

const sectionTitle: React.CSSProperties = {
  fontWeight: 800,
  marginBottom: 6,
  opacity: 0.95,
};

const txRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "8px 10px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(255,255,255,0.03)",
  textDecoration: "none",
  color: "white",
  minWidth: 0,
};

const txBtn: React.CSSProperties = {
  display: "inline-block",
  padding: "6px 10px",
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(255,255,255,0.06)",
  fontWeight: 900,
  fontSize: 12,
  whiteSpace: "nowrap",
  flexShrink: 0,
};

const txSig: React.CSSProperties = {
  fontSize: 12,
  opacity: 0.9,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  overflowWrap: "anywhere",
  minWidth: 0,
};

const txMuted: React.CSSProperties = {
  marginTop: 10,
  fontSize: 12,
  opacity: 0.65,
  lineHeight: 1.35,
};
