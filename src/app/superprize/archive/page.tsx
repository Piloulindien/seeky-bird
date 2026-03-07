// src/app/superprize/archive/page.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type ArchiveWinner = {
  rank: number;
  wallet: string;
  name: string;
  score: number;
  amountSol: number;
};

type ArchiveEvent = {
  id: string;
  status: "live" | "frozen" | "settled";
  startAt: number;
  endAt: number;
  freezeAt: number;
  prizePoolSol: number;
  entrySol: number;
  totalEntrySol: number;
  entriesCount: number;
  createdAt: number;
  settledAt: number | null;
};

type ArchiveItem = {
  event: ArchiveEvent;
  winners: ArchiveWinner[];
};

type ArchiveResponse = {
  items: ArchiveItem[];
  limit: number;
  offset: number;
};

function fmtDate(ts: number) {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

export default function SuperPrizeArchivePage() {
  const [items, setItems] = useState<ArchiveItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const limit = 12;

  const hasMore = useMemo(
    () => items.length > 0 && items.length % limit === 0,
    [items.length],
  );

  useEffect(() => {
    let cancelled = false;

    const refresh = async (nextOffset: number) => {
      setLoading(true);

      const r = await fetch(
        `/api/superprize/archive?limit=${limit}&offset=${nextOffset}`,
        { cache: "no-store" },
      ).catch(() => null);

      if (!r || !r.ok) {
        if (!cancelled) {
          setItems([]);
          setLoading(false);
        }
        return;
      }

      const j = (await r.json().catch(() => null)) as ArchiveResponse | null;
      const next = j?.items ?? [];

      if (!cancelled) {
        setItems(next);
        setLoading(false);
      }
    };

    window.setTimeout(() => refresh(offset), 0);

    return () => {
      cancelled = true;
    };
  }, [offset]);

  return (
    <main style={wrap}>
      <div style={shell}>
        <div style={topLinks}>
          <Link href="/" style={homeBtn}>
            ⬅ Home
          </Link>
          <Link href="/superprize" style={homeBtn}>
            🏆 SuperPrize (live)
          </Link>
        </div>

        <h1 style={h1}>🏆 SuperPrize Archives</h1>
        <div style={sub}>Past events (settled) with Top 3 payouts.</div>

        {loading ? (
          <div style={card}>
            <div style={{ fontWeight: 950 }}>Loading…</div>
            <div style={muted}>Fetching settled events.</div>
          </div>
        ) : items.length === 0 ? (
          <div style={card}>
            <div style={{ fontWeight: 950 }}>No archived events</div>
            <div style={muted}>
              Once an event is settled, it will appear here.
            </div>
          </div>
        ) : (
          <>
            <div style={grid}>
              {items.map((it) => {
                const href = `/superprize?eventId=${encodeURIComponent(
                  it.event.id,
                )}`;

                return (
                  <Link key={it.event.id} href={href} style={eventLink}>
                    <div style={eventCard}>
                      <div style={eventTop}>
                        <div style={{ fontWeight: 950 }}>
                          Event <span style={settledTag}>settled</span>
                        </div>
                        <div style={pill}>
                          {it.event.prizePoolSol.toFixed(3)} SOL
                        </div>
                      </div>

                      <div style={meta}>
                        <div>
                          <span style={metaK}>End</span>{" "}
                          <span style={metaV}>{fmtDate(it.event.endAt)}</span>
                        </div>
                        <div>
                          <span style={metaK}>Entry</span>{" "}
                          <span style={metaV}>
                            {it.event.entrySol.toFixed(3)} SOL
                          </span>
                        </div>
                      </div>

                      <div style={{ marginTop: 10 }}>
                        <div style={{ fontWeight: 950, marginBottom: 6 }}>
                          Top 3
                        </div>

                        {it.winners.length === 0 ? (
                          <div style={muted}>No winners recorded.</div>
                        ) : (
                          <div style={winnersCol}>
                            {it.winners.slice(0, 3).map((w) => (
                              <div
                                key={`${it.event.id}-${w.rank}`}
                                style={winnerRowCompact}
                              >
                                <span style={{ opacity: 0.95 }}>#{w.rank}</span>
                                <span style={{ flex: 1, fontWeight: 800 }}>
                                  {w.name}{" "}
                                  <span style={{ opacity: 0.8 }}>
                                    · {w.score}
                                  </span>
                                </span>
                                <span style={{ opacity: 0.95 }}>
                                  +{w.amountSol.toFixed(3)} SOL
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      <div style={idLine}>
                        ID: <span style={mono}>{it.event.id}</span>
                      </div>

                      <div style={ctaHint}>→ View event</div>
                    </div>
                  </Link>
                );
              })}
            </div>

            <div style={pager}>
              <button
                style={{
                  ...btn,
                  opacity: offset > 0 ? 1 : 0.5,
                  cursor: offset > 0 ? "pointer" : "default",
                }}
                disabled={offset <= 0}
                onClick={() => setOffset((o) => Math.max(0, o - limit))}
              >
                ← Prev
              </button>

              <div style={{ opacity: 0.8, fontSize: 13 }}>
                Page {Math.floor(offset / limit) + 1}
              </div>

              <button
                style={{
                  ...btn,
                  opacity: hasMore ? 1 : 0.5,
                  cursor: hasMore ? "pointer" : "default",
                }}
                disabled={!hasMore}
                onClick={() => setOffset((o) => o + limit)}
              >
                Next →
              </button>
            </div>
          </>
        )}
      </div>
    </main>
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
  width: "min(900px, 100%)",
  margin: "0 auto",
};

const topLinks: React.CSSProperties = {
  marginBottom: 12,
  display: "flex",
  gap: 10,
  flexWrap: "wrap",
};

const h1: React.CSSProperties = {
  fontSize: 24,
  margin: "10px 0 6px",
  fontWeight: 950,
};

const sub: React.CSSProperties = {
  opacity: 0.75,
  fontSize: 13,
  marginBottom: 14,
};

const grid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
  gap: 12,
};

const card: React.CSSProperties = {
  padding: 12,
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.15)",
  background: "rgba(255,255,255,0.06)",
  marginTop: 12,
};

const eventLink: React.CSSProperties = {
  textDecoration: "none",
  color: "inherit",
  display: "block",
};

const eventCard: React.CSSProperties = {
  padding: 14,
  borderRadius: 16,
  border: "1px solid rgba(255,255,255,0.15)",
  background: "rgba(255,255,255,0.06)",
};

const eventTop: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 10,
};

const settledTag: React.CSSProperties = {
  opacity: 0.7,
  fontWeight: 800,
  marginLeft: 8,
  fontSize: 12,
};

const pill: React.CSSProperties = {
  padding: "7px 10px",
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(255,255,255,0.06)",
  fontSize: 12,
  fontWeight: 900,
};

const meta: React.CSSProperties = {
  marginTop: 10,
  display: "flex",
  flexDirection: "column",
  gap: 6,
  opacity: 0.9,
  fontSize: 13,
};

const metaK: React.CSSProperties = { opacity: 0.7 };
const metaV: React.CSSProperties = { fontWeight: 800 };

const winnersCol: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const winnerRowCompact: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "8px 10px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(255,255,255,0.03)",
  fontSize: 13,
};

const idLine: React.CSSProperties = {
  marginTop: 10,
  opacity: 0.7,
  fontSize: 12,
};

const mono: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
};

const ctaHint: React.CSSProperties = {
  marginTop: 10,
  fontSize: 13,
  fontWeight: 900,
  opacity: 0.8,
};

const muted: React.CSSProperties = { opacity: 0.7, marginTop: 6 };

const pager: React.CSSProperties = {
  marginTop: 14,
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 10,
};

const btn: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.2)",
  background: "rgba(255,255,255,0.08)",
  color: "white",
  fontWeight: 900,
};

const homeBtn: React.CSSProperties = {
  display: "inline-block",
  padding: "9px 11px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.2)",
  background: "rgba(255,255,255,0.06)",
  color: "white",
  textDecoration: "none",
  fontWeight: 800,
  fontSize: 13,
};
