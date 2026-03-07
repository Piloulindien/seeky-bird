"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

type Row = { wallet?: string; name: string; score: number };

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

type DailyStateRes = {
  ok: boolean;
  day: string;
  entrySol: number;
  poolSol: number;
  entries: number;
};

type DailyTopRes = {
  ok: boolean;
  day: string;
  top: Array<{ wallet: string; name: string; score: number }>;
};

function formatISOToHuman(iso: string) {
  try {
    const [y, m, d] = iso.split("-").map((x) => Number(x));
    const dt = new Date(y, (m || 1) - 1, d || 1);
    return dt.toLocaleDateString();
  } catch {
    return iso;
  }
}

export default function DailyPage() {
  const sp = useSearchParams();
  const router = useRouter();

  const [mounted, setMounted] = useState(false);

  // today
  const [today, setToday] = useState<DailyStateRes | null>(null);
  const [top3Today, setTop3Today] = useState<Row[]>([]);

  // history
  const [history, setHistory] = useState<DailyDistribution[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // init selected date from URL
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    const qd = sp.get("date");
    return (qd || "").trim();
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.setTimeout(() => setMounted(true), 0);
  }, []);

  // fetch today + top3 (poll)
  useEffect(() => {
    if (!mounted) return;

    let alive = true;

    const tick = async () => {
      try {
        const r = await fetch("/api/daily/state", { cache: "no-store" });
        if (!r.ok) return;

        const st = (await r.json().catch(() => null)) as DailyStateRes | null;
        if (!alive || !st?.ok) return;

        setToday(st);

        const r2 = await fetch(
          `/api/daily/leaderboard?day=${encodeURIComponent(st.day || "")}`,
          { cache: "no-store" },
        );
        if (!r2.ok) {
          setTop3Today([]);
          return;
        }

        const top = (await r2.json().catch(() => null)) as DailyTopRes | null;
        if (!alive || !top?.ok) return;

        setTop3Today((top.top ?? []).slice(0, 3));
      } catch {
        // keep last UI
      }
    };

    void tick();
    const t = window.setInterval(tick, 2000);

    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [mounted]);

  // fetch history
  useEffect(() => {
    if (!mounted) return;

    let alive = true;
    setLoadingHistory(true);

    const run = async () => {
      try {
        const r = await fetch("/api/daily/history", { cache: "no-store" });
        if (!r.ok) {
          if (alive) setHistory([]);
          return;
        }
        const j = (await r.json().catch(() => null)) as {
          items?: DailyDistribution[];
        } | null;

        if (!alive) return;
        setHistory(Array.isArray(j?.items) ? j!.items : []);
      } finally {
        if (alive) setLoadingHistory(false);
      }
    };

    void run();
    return () => {
      alive = false;
    };
  }, [mounted]);

  const effectiveSelectedDate = useMemo(() => {
    if (selectedDate) return selectedDate;
    return history[0]?.date || "";
  }, [selectedDate, history]);

  // keep URL synced
  useEffect(() => {
    if (!mounted) return;
    if (!effectiveSelectedDate) return;

    const q = new URLSearchParams(sp.toString());
    q.set("date", effectiveSelectedDate);
    router.replace(`/daily?${q.toString()}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, effectiveSelectedDate]);

  const selectedDist: DailyDistribution | null = useMemo(() => {
    if (!effectiveSelectedDate) return null;
    return history.find((d) => d.date === effectiveSelectedDate) ?? null;
  }, [history, effectiveSelectedDate]);

  const selectedTop3: Row[] = useMemo(() => {
    const snap = selectedDist?.top3Snapshot;
    if (!Array.isArray(snap)) return [];
    return snap.slice(0, 3).map((x) => ({ name: x.name, score: x.score }));
  }, [selectedDist]);

  return (
    <main style={wrap}>
      <div style={shell}>
        <div style={{ marginBottom: 12 }}>
          <Link href="/" style={homeBtn}>
            ⬅ Home
          </Link>
        </div>

        <h1 style={h1}>📅 Daily Tournament</h1>

        {/* TODAY */}
        <div style={card}>
          <div style={{ fontWeight: 900, marginBottom: 6 }}>Today</div>

          {today?.ok ? (
            <div style={meta}>
              Entry: <b>{today.entrySol.toFixed(2)} SOL</b> · Pool:{" "}
              <b>{today.poolSol.toFixed(3)} SOL</b> · Entries:{" "}
              <b>{today.entries}</b>
            </div>
          ) : (
            <div style={meta}>Loading…</div>
          )}

          <TopList rows={top3Today} empty="No daily scores yet." max={3} />
        </div>

        <div style={{ marginTop: 14 }} />

        {/* PAST DAYS */}
        <div style={card}>
          <div style={{ fontWeight: 900, marginBottom: 6 }}>Past days</div>

          {loadingHistory ? (
            <div style={muted}>Loading…</div>
          ) : history.length === 0 ? (
            <div style={muted}>No daily distributions yet.</div>
          ) : (
            <>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <div style={{ opacity: 0.85, fontSize: 13, paddingTop: 8 }}>
                  Select date:
                </div>

                <select
                  value={effectiveSelectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  style={select}
                >
                  {history.map((d) => (
                    <option key={d.date} value={d.date}>
                      {d.date} · {formatISOToHuman(d.date)}
                    </option>
                  ))}
                </select>
              </div>

              {selectedDist ? (
                <div style={{ marginTop: 12 }}>
                  <div style={meta}>
                    Pool settled: <b>{selectedDist.poolSol.toFixed(3)} SOL</b>
                  </div>

                  <div
                    style={{ marginTop: 10, fontWeight: 800, opacity: 0.95 }}
                  >
                    Payouts (Top3)
                  </div>

                  {selectedDist.payouts.length === 0 ? (
                    <div style={muted}>No payouts.</div>
                  ) : (
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                        marginTop: 8,
                      }}
                    >
                      {selectedDist.payouts.slice(0, 3).map((p) => (
                        <div key={`${p.rank}-${p.name}`} style={row}>
                          <span>
                            #{p.rank} <b>{p.name}</b> ({p.score})
                          </span>
                          <span>{p.amountSol.toFixed(4)} SOL</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <div
                    style={{ marginTop: 14, fontWeight: 800, opacity: 0.95 }}
                  >
                    Top 3 (snapshot)
                  </div>

                  <TopList
                    rows={selectedTop3}
                    empty="No snapshot available for this day."
                    max={3}
                  />
                </div>
              ) : (
                <div style={{ marginTop: 10, ...muted }}>
                  Select a date to view results.
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </main>
  );
}

function TopList({
  rows,
  empty,
  max,
}: {
  rows: Row[];
  empty: string;
  max: number;
}) {
  if (!rows.length) return <div style={muted}>{empty}</div>;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        marginTop: 10,
      }}
    >
      {rows.slice(0, max).map((p, i) => (
        <div key={`${p.name}-${p.score}-${i}`} style={row}>
          <span>
            #{i + 1} <b>{p.name}</b>
          </span>
          <span>{p.score}</span>
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
};

const shell: React.CSSProperties = {
  width: "min(720px, 100%)",
  margin: "0 auto",
};

const h1: React.CSSProperties = {
  fontSize: 26,
  margin: "14px 0",
};

const card: React.CSSProperties = {
  padding: 12,
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.15)",
  background: "rgba(255,255,255,0.06)",
};

const meta: React.CSSProperties = {
  opacity: 0.85,
  fontSize: 13,
};

const row: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(255,255,255,0.03)",
};

const muted: React.CSSProperties = {
  opacity: 0.7,
  paddingTop: 10,
};

const select: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.18)",
  background: "rgba(255,255,255,0.06)",
  color: "white",
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
