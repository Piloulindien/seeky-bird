"use client";

import Link from "next/link";
import { useMemo, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type Tab = "normal" | "daily" | "superprize";

function parseTab(v: string | null): Tab {
  if (v === "daily") return "daily";
  if (v === "superprize") return "superprize";
  return "normal";
}

function parseRound(v: string | null): number {
  const n = Number(v || "0");
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function parseDay(v: string | null): string {
  const s = String(v || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
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

/* ---------------- Types ---------------- */

type NormalStatusResponse = {
  round: { id: number; poolSol: number };
  settlingRoundId: number | null;
  settleInMs: number | null;
  graceMs: number;
};

type NormalTopRes = {
  ok: boolean;
  roundId: number;
  top: Array<{ wallet: string; name: string; score: number }>;
};

type NormalHistoryRes = {
  items: Array<{ at: number; roundId: number }>;
  limit: number;
  offset: number;
};

type DailyStatusResponse = {
  day: { day: string; poolSol: number };
  top3: Array<{ wallet: string; name: string; score: number }>;
};

type DailyHistoryResponse = {
  ok: boolean;
  items: Array<{ date: string }>;
  limit: number;
  offset: number;
};

/* ---------------- SuperPrize types ---------------- */

type SpEvent = {
  id: string;
  status: "live" | "frozen" | "settled";
  prizePoolSol: number;
  entrySol: number;
  endAt: number;
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

type SpLeaderboardResponse = {
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

export default function LeaderboardClient() {
  const sp = useSearchParams();
  const router = useRouter();

  const tab = useMemo(() => parseTab(sp.get("tab")), [sp]);
  const urlRound = useMemo(() => parseRound(sp.get("round")), [sp]);
  const urlDay = useMemo(() => parseDay(sp.get("day")), [sp]);
  const urlEventId = useMemo(() => parseEventId(sp.get("eventId")), [sp]);

  /* ---------------- Normal ---------------- */

  const [currentRoundId, setCurrentRoundId] = useState<number>(0);
  const [normalRounds, setNormalRounds] = useState<number[]>([]);
  const [normalTop10, setNormalTop10] = useState<
    Array<{ name: string; score: number }>
  >([]);
  const [normalRoundLastPayoutAt, setNormalRoundLastPayoutAt] = useState<
    Map<number, number>
  >(new Map());

  const effectiveRoundId =
    tab === "normal" ? urlRound || currentRoundId || 0 : 0;
  const isViewingCurrentRound =
    tab === "normal" &&
    !!effectiveRoundId &&
    effectiveRoundId === currentRoundId;

  useEffect(() => {
    if (typeof window === "undefined") return;

    let alive = true;

    const tick = async () => {
      const r = await fetch("/api/normal/status", { cache: "no-store" }).catch(
        () => null,
      );
      if (!alive || !r || !r.ok) return;
      const j = (await r
        .json()
        .catch(() => null)) as NormalStatusResponse | null;
      if (!alive || !j?.round?.id) return;
      const rid = Number(j.round.id || 0);
      if (rid > 0) setCurrentRoundId(rid);
    };

    void tick();
    const t = window.setInterval(tick, 1500);

    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, []);

  useEffect(() => {
    if (tab !== "normal") return;
    if (urlRound) return;
    if (!currentRoundId) return;

    const q = new URLSearchParams(sp.toString());
    q.set("tab", "normal");
    q.set("round", String(currentRoundId));
    q.delete("day");
    q.delete("eventId");
    router.replace(`/leaderboard?${q.toString()}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, urlRound, currentRoundId]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let alive = true;

    const run = async () => {
      const r = await fetch("/api/normal/history?limit=200&offset=0", {
        cache: "no-store",
      }).catch(() => null);

      if (!alive) return;

      const j = (await r?.json().catch(() => null)) as NormalHistoryRes | null;

      const items = Array.isArray(j?.items) ? j.items : [];
      const idsFromHistory = items
        .map((x) => Number(x.roundId || 0))
        .filter((x) => x > 0);

      const all = new Set<number>(idsFromHistory);
      if (currentRoundId > 0) all.add(currentRoundId);

      const uniqDesc = Array.from(all.values()).sort((a, b) => b - a);
      setNormalRounds(uniqDesc);

      const map = new Map<number, number>();
      for (const d of items) {
        const rid = Number(d.roundId || 0);
        const at = Number(d.at || 0);
        if (!rid || !at) continue;
        const prev = map.get(rid) || 0;
        if (at > prev) map.set(rid, at);
      }
      setNormalRoundLastPayoutAt(map);
    };

    void run();
    const t = window.setInterval(run, 2500);

    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [currentRoundId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (tab !== "normal") return;

    if (!effectiveRoundId) {
      setNormalTop10([]);
      return;
    }

    let alive = true;

    const run = async () => {
      const r = await fetch(
        `/api/normal/leaderboard?round=${encodeURIComponent(
          String(effectiveRoundId),
        )}`,
        {
          cache: "no-store",
        },
      ).catch(() => null);

      if (!alive) return;

      if (!r || !r.ok) {
        setNormalTop10([]);
        return;
      }

      const j = (await r.json().catch(() => null)) as NormalTopRes | null;
      const rows = j?.ok && Array.isArray(j.top) ? j.top : [];
      setNormalTop10(
        rows.slice(0, 10).map((x) => ({ name: x.name, score: x.score })),
      );
    };

    void run();

    if (!isViewingCurrentRound) {
      return () => {
        alive = false;
      };
    }

    const t = window.setInterval(run, 1500);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [tab, effectiveRoundId, isViewingCurrentRound]);

  const normalRoundMetaText = useMemo(() => {
    if (!effectiveRoundId) return "";
    const at = normalRoundLastPayoutAt.get(effectiveRoundId) || 0;
    return at ? `Last payout: ${fmtDT(at)}` : "";
  }, [effectiveRoundId, normalRoundLastPayoutAt]);

  /* ---------------- Daily ---------------- */

  const [dailyDays, setDailyDays] = useState<string[]>([]);
  const [dailyTop3, setDailyTop3] = useState<
    Array<{ name: string; score: number }>
  >([]);
  const [dailyToday, setDailyToday] = useState<string>("");

  useEffect(() => {
    if (typeof window === "undefined") return;

    let alive = true;

    const tick = async () => {
      const r = await fetch("/api/daily/status", { cache: "no-store" }).catch(
        () => null,
      );
      if (!alive || !r || !r.ok) return;
      const j = (await r
        .json()
        .catch(() => null)) as DailyStatusResponse | null;
      const dayStr = String(j?.day?.day || "").trim();
      if (dayStr) setDailyToday(dayStr);
    };

    void tick();
    const t = window.setInterval(tick, 4000);

    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let alive = true;

    const run = async () => {
      const r = await fetch("/api/daily/history?limit=200&offset=0", {
        cache: "no-store",
      }).catch(() => null);
      if (!alive) return;

      const fromHistory: string[] = [];

      if (r && r.ok) {
        const j = (await r
          .json()
          .catch(() => null)) as DailyHistoryResponse | null;
        const items = Array.isArray(j?.items) ? j.items : [];
        for (const it of items) {
          const d = String(it.date || "").trim();
          if (d) fromHistory.push(d);
        }
      }

      const all = new Set<string>(fromHistory);
      if (dailyToday) all.add(dailyToday);

      const uniq = Array.from(all.values()).sort((a, b) => (a < b ? 1 : -1));
      setDailyDays(uniq);
    };

    void run();
    const t = window.setInterval(run, 4000);

    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [dailyToday]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (tab !== "daily") return;

    let alive = true;

    const run = async () => {
      const q = urlDay ? `?day=${encodeURIComponent(urlDay)}` : "";
      const r = await fetch(`/api/daily/status${q}`, {
        cache: "no-store",
      }).catch(() => null);
      if (!alive) return;

      if (!r || !r.ok) {
        setDailyTop3([]);
        return;
      }

      const j = (await r
        .json()
        .catch(() => null)) as DailyStatusResponse | null;
      const top3 = Array.isArray(j?.top3) ? j.top3 : [];
      setDailyTop3(
        top3.slice(0, 3).map((x) => ({ name: x.name, score: x.score })),
      );
    };

    void run();
    const t = window.setInterval(run, 2000);

    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [tab, urlDay]);

  /* ---------------- SuperPrize ---------------- */

  const [spEvents, setSpEvents] = useState<SpEvent[]>([]);
  const [spLoading, setSpLoading] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let cancelled = false;

    const run = async () => {
      setSpLoading(true);

      const [cur, arc] = await Promise.all([
        fetch("/api/superprize/leaderboard", { cache: "no-store" })
          .then((r) =>
            r.ok ? (r.json() as Promise<SpLeaderboardResponse>) : null,
          )
          .catch(() => null),
        fetch("/api/superprize/archive?limit=50&offset=0", {
          cache: "no-store",
        })
          .then((r) => (r.ok ? (r.json() as Promise<SpArchiveResponse>) : null))
          .catch(() => null),
      ]);

      if (cancelled) return;

      const items = arc?.items ?? [];
      const settled = items.map((it) => it.event);
      const liveOrFrozen = cur?.event ? [cur.event] : [];

      const byId = new Map<string, SpEvent>();
      for (const ev of [...liveOrFrozen, ...settled]) {
        if (!ev?.id) continue;
        if (!byId.has(ev.id)) byId.set(ev.id, ev);
      }

      const arr = Array.from(byId.values()).sort(
        (a, b) => (b.endAt || 0) - (a.endAt || 0),
      );

      setSpEvents(arr);
      setSpLoading(false);
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, []);

  const selectedEventId = useMemo(() => {
    if (tab !== "superprize") return "";
    if (urlEventId) return urlEventId;
    return spEvents.length ? spEvents[0].id : "";
  }, [tab, urlEventId, spEvents]);

  const selectedEvent = useMemo(() => {
    if (!selectedEventId) return null;
    return spEvents.find((e) => e.id === selectedEventId) || null;
  }, [spEvents, selectedEventId]);

  const superLabel = useMemo(() => {
    if (!selectedEventId) return "SuperPrize";
    const idx = spEvents.findIndex((e) => e.id === selectedEventId);
    const base = idx === -1 ? "SuperPrize" : `SuperPrize #${idx + 1}`;
    const ends = selectedEvent?.endAt ? fmtDT(selectedEvent.endAt) : "";
    return ends ? `${base} · Ends ${ends}` : base;
  }, [spEvents, selectedEventId, selectedEvent]);

  useEffect(() => {
    if (tab !== "superprize") return;
    if (!selectedEventId) return;

    const q = new URLSearchParams(sp.toString());
    q.set("tab", "superprize");
    q.set("eventId", selectedEventId);
    q.delete("round");
    q.delete("day");

    router.replace(`/leaderboard?${q.toString()}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, selectedEventId]);

  const [spTop3, setSpTop3] = useState<Array<{ name: string; score: number }>>(
    [],
  );
  const [spMeta, setSpMeta] = useState<SpEvent | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (tab !== "superprize") return;

    let cancelled = false;

    if (!selectedEventId) {
      window.setTimeout(() => {
        if (cancelled) return;
        setSpTop3([]);
        setSpMeta(null);
      }, 0);
      return () => {
        cancelled = true;
      };
    }

    const run = async () => {
      const r = await fetch(
        `/api/superprize/event?id=${encodeURIComponent(selectedEventId)}`,
        {
          cache: "no-store",
        },
      ).catch(() => null);

      if (!r || !r.ok) return;
      const j = (await r
        .json()
        .catch(() => null)) as SpLeaderboardResponse | null;
      if (cancelled) return;

      const ev = j?.event ?? null;
      const top = Array.isArray(j?.top) ? j.top : [];
      const top3 = top
        .slice(0, 3)
        .map((x) => ({ name: x.name, score: x.score }));

      setSpMeta(ev);
      setSpTop3(top3);
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [tab, selectedEventId]);

  /* ---------------- URL writers ---------------- */

  const setTabUrl = (nextTab: Tab) => {
    const q = new URLSearchParams(sp.toString());
    q.set("tab", nextTab);

    if (nextTab === "normal") {
      const rid = urlRound || currentRoundId || 0;
      if (rid) q.set("round", String(rid));
      q.delete("day");
      q.delete("eventId");
    } else if (nextTab === "daily") {
      if (urlDay) q.set("day", urlDay);
      q.delete("round");
      q.delete("eventId");
    } else {
      q.delete("round");
      q.delete("day");
    }

    router.replace(`/leaderboard?${q.toString()}`);
  };

  const setRoundUrl = (rid: number) => {
    const q = new URLSearchParams(sp.toString());
    q.set("tab", "normal");
    if (rid) q.set("round", String(rid));
    q.delete("day");
    q.delete("eventId");
    router.replace(`/leaderboard?${q.toString()}`);
  };

  const setDayUrl = (d: string) => {
    const q = new URLSearchParams(sp.toString());
    q.set("tab", "daily");
    if (d) q.set("day", d);
    else q.delete("day");
    q.delete("round");
    q.delete("eventId");
    router.replace(`/leaderboard?${q.toString()}`);
  };

  const setEventUrl = (id: string) => {
    const q = new URLSearchParams(sp.toString());
    q.set("tab", "superprize");
    if (id) q.set("eventId", id);
    else q.delete("eventId");
    q.delete("round");
    q.delete("day");
    router.replace(`/leaderboard?${q.toString()}`);
  };

  return (
    <main style={wrap}>
      <div style={shell}>
        <div style={{ marginBottom: 12 }}>
          <Link href="/" style={homeBtn}>
            ⬅ Home
          </Link>
        </div>

        <h1 style={h1}>🏆 Leaderboards</h1>

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

        {tab === "normal" && (
          <div style={card}>
            <div style={cardHeader}>
              <div style={cardHeaderText}>
                <div style={{ fontWeight: 900 }}>
                  Normal · Round #{effectiveRoundId || "—"}
                </div>
                <div style={scopeText}>
                  Scope: ranked <b>inside this round</b>.
                  {normalRoundMetaText ? (
                    <>
                      {" "}
                      ·{" "}
                      <span style={{ opacity: 0.92 }}>
                        {normalRoundMetaText}
                      </span>
                    </>
                  ) : null}
                  {isViewingCurrentRound ? (
                    <>
                      {" "}
                      · <span style={{ opacity: 0.92 }}>live</span>
                    </>
                  ) : null}
                </div>
              </div>

              <select
                value={effectiveRoundId || 0}
                onChange={(e) => setRoundUrl(parseRound(e.target.value))}
                style={select}
              >
                {!normalRounds.length && currentRoundId > 0 && (
                  <option value={currentRoundId}>
                    Current round (#{currentRoundId})
                  </option>
                )}

                {normalRounds.map((rid) => {
                  const at = normalRoundLastPayoutAt.get(rid) || 0;
                  const suffix = at ? ` · last payout ${fmtDT(at)}` : "";
                  const label =
                    rid === currentRoundId
                      ? `Current round (#${rid})${suffix}`
                      : `Round #${rid}${suffix}`;
                  return (
                    <option key={rid} value={rid}>
                      {label}
                    </option>
                  );
                })}
              </select>
            </div>

            <TopList
              rows={normalTop10}
              empty="No scores for this round yet."
              max={10}
            />
          </div>
        )}

        {tab === "daily" && (
          <div style={card}>
            <div style={cardHeader}>
              <div style={cardHeaderText}>
                <div style={{ fontWeight: 900 }}>
                  Daily · {urlDay ? urlDay : "Today"}
                </div>
                <div style={scopeText}>
                  Scope: ranked for <b>that day only</b>.
                </div>
              </div>

              <select
                value={urlDay || ""}
                onChange={(e) => setDayUrl(parseDay(e.target.value))}
                style={select}
              >
                <option value="">
                  Today{dailyToday ? ` (${dailyToday})` : ""}
                </option>

                {dailyDays
                  .filter((d) => d !== dailyToday)
                  .map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
              </select>
            </div>

            <TopList rows={dailyTop3} empty="No daily scores yet." max={3} />
          </div>
        )}

        {tab === "superprize" && (
          <div style={card}>
            <div style={cardHeader}>
              <div style={cardHeaderText}>
                <div style={{ fontWeight: 900 }}>{superLabel}</div>
                <div style={scopeText}>
                  Scope: ranked for <b>that event</b>. Payouts Top 3.
                </div>
              </div>

              <select
                value={selectedEventId || ""}
                onChange={(e) => setEventUrl(String(e.target.value || ""))}
                style={select}
              >
                {!spEvents.length && (
                  <option value="">
                    {spLoading ? "Loading..." : "No events"}
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

            {spMeta && (
              <div style={metaText}>
                Prize: <b>{spMeta.prizePoolSol.toFixed(3)} SOL</b> · Entry:{" "}
                <b>{spMeta.entrySol.toFixed(3)} SOL</b>
                {spMeta.endAt ? (
                  <>
                    {" "}
                    · Ends: <b>{fmtDT(spMeta.endAt)}</b>
                  </>
                ) : null}
              </div>
            )}

            <TopList rows={spTop3} empty="No superprize scores yet." max={3} />
          </div>
        )}
      </div>
    </main>
  );
}

function TopList(props: {
  rows: Array<{ name: string; score: number }>;
  empty: string;
  max: number;
}) {
  if (!props.rows.length) return <div style={muted}>{props.empty}</div>;

  return (
    <div style={list}>
      {props.rows.slice(0, props.max).map((p, i) => (
        <div key={`${p.name}-${p.score}-${i}`} style={row}>
          <span style={rowName}>
            #{i + 1} <b>{p.name}</b>
          </span>
          <span style={rowScore}>{p.score}</span>
        </div>
      ))}
    </div>
  );
}

/* styles */
const wrap: React.CSSProperties = {
  minHeight: "100vh",
  background: "#020617",
  color: "white",
  padding: 16,
  fontFamily: "system-ui",
  overflowX: "hidden",
};

const shell: React.CSSProperties = {
  width: "min(760px, 100%)",
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
};

const cardHeaderText: React.CSSProperties = {
  minWidth: 0,
  flex: "1 1 220px",
};

const scopeText: React.CSSProperties = {
  marginTop: 4,
  fontSize: 13,
  opacity: 0.82,
  lineHeight: 1.35,
  overflowWrap: "anywhere",
};

const list: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  marginTop: 10,
};

const row: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 10,
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(255,255,255,0.03)",
};

const rowName: React.CSSProperties = {
  minWidth: 0,
  overflowWrap: "anywhere",
};

const rowScore: React.CSSProperties = {
  flexShrink: 0,
  fontWeight: 900,
};

const muted: React.CSSProperties = {
  opacity: 0.7,
  paddingTop: 10,
};

const select: React.CSSProperties = {
  padding: "10px 12px",
  minHeight: 42,
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.18)",
  background: "rgba(255,255,255,0.06)",
  color: "white",
  width: "100%",
  flex: "1 1 240px",
  minWidth: 0,
};

const metaText: React.CSSProperties = {
  marginTop: 10,
  fontSize: 13,
  opacity: 0.82,
  lineHeight: 1.35,
  overflowWrap: "anywhere",
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
