// src/app/superprize/page.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Event = { id: string; status: "live" | "frozen" | "settled" };
type Row = { wallet: string; name: string; score: number };

type SuperLbResponse = {
  event: Event | null;
  top: Row[];
  winners: Array<{
    rank: number;
    wallet: string;
    name: string;
    score: number;
    amountSol: number;
  }>;
};

type SuperEventOpt = { id: string; label: string };

export default function SuperPrizePage() {
  const [mounted, setMounted] = useState(false);

  const [events, setEvents] = useState<SuperEventOpt[]>([]);
  const [eventId, setEventId] = useState<string>("");

  const [top3, setTop3] = useState<Array<{ name: string; score: number }>>([]);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted) return;

    let alive = true;

    const load = async () => {
      const st = await fetch(`/api/superprize/status?t=${Date.now()}`, {
        cache: "no-store",
      })
        .then((r) => r.json() as Promise<{ event: Event | null }>)
        .catch(() => ({ event: null }));

      const arch = await fetch(`/api/superprize/archive?limit=50&offset=0`, {
        cache: "no-store",
      })
        .then(
          (r) =>
            r.json() as Promise<{
              items: Array<{ event: { id: string; status: string } }>;
            }>,
        )
        .catch(() => ({
          items: [] as Array<{ event: { id: string; status: string } }>,
        }));

      if (!alive) return;

      const opts: SuperEventOpt[] = [];

      if (st.event?.id) {
        opts.push({
          id: st.event.id,
          label: `Active (${st.event.status}) · ${st.event.id.slice(0, 8)}…`,
        });
      }

      for (const it of arch.items || []) {
        const ev = it?.event;
        if (!ev?.id) continue;
        opts.push({
          id: ev.id,
          label: `Settled · ${ev.id.slice(0, 8)}…`,
        });
      }

      // unique
      const seen = new Set<string>();
      const uniq = opts.filter((o) => {
        if (seen.has(o.id)) return false;
        seen.add(o.id);
        return true;
      });

      setEvents(uniq);

      if (!eventId) {
        if (st.event?.id) setEventId(st.event.id);
        else if (uniq[0]?.id) setEventId(uniq[0].id);
      }
    };

    void load();

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted]);

  useEffect(() => {
    if (!mounted) return;

    let alive = true;

    const tick = async () => {
      if (!eventId) {
        setTop3([]);
        return;
      }

      const j = await fetch(
        `/api/superprize/event?id=${encodeURIComponent(eventId)}`,
        { cache: "no-store" },
      )
        .then((r) => r.json() as Promise<SuperLbResponse>)
        .catch(() => ({ event: null, top: [], winners: [] }));

      if (!alive) return;

      setTop3(
        (j.top || [])
          .slice(0, 3)
          .map((r) => ({ name: r.name, score: r.score })),
      );
    };

    void tick();
    const t = window.setInterval(tick, 2000);

    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [mounted, eventId]);

  return (
    <main style={wrap}>
      <div style={shell}>
        <div style={{ marginBottom: 12 }}>
          <Link href="/" style={homeBtn}>
            ⬅ Home
          </Link>
        </div>

        <div style={headRow}>
          <div>
            <div style={h1}>SuperPrize · Event</div>
            <div style={sub}>
              Pick an event (live/frozen/settled). Payouts <b>Top 3</b>.
            </div>
          </div>

          <select
            value={eventId}
            onChange={(e) => setEventId(String(e.target.value || ""))}
            style={select}
            disabled={!mounted}
          >
            {!mounted ? (
              <option value="">Loading…</option>
            ) : events.length === 0 ? (
              <option value="">No events</option>
            ) : (
              events.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.label}
                </option>
              ))
            )}
          </select>
        </div>

        <div style={card}>
          <div style={{ fontWeight: 900, marginBottom: 10 }}>Top 3</div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {Array.from({ length: 3 }).map((_, i) => {
              const r = top3[i];
              return (
                <div key={i} style={row}>
                  <span>
                    #{i + 1} <b>{r?.name ?? "—"}</b>
                  </span>
                  <span>{typeof r?.score === "number" ? r.score : "—"}</span>
                </div>
              );
            })}
          </div>
        </div>
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
  width: "min(720px, 100%)",
  margin: "0 auto",
};

const headRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  flexWrap: "wrap",
};

const h1: React.CSSProperties = { fontSize: 26, fontWeight: 950 };

const sub: React.CSSProperties = { opacity: 0.75, marginTop: 6, fontSize: 13 };

const card: React.CSSProperties = {
  marginTop: 12,
  padding: 12,
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.15)",
  background: "rgba(255,255,255,0.06)",
};

const row: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(255,255,255,0.03)",
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
