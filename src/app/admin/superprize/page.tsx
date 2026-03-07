"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Event = {
  id: string;
  status: "live" | "frozen" | "settled";
  startAt: number;
  endAt: number;
  freezeAt: number;
  prizePoolSol: number;
  entrySol: number;
  totalEntrySol: number;
  entriesCount: number;
  payoutTxSigs?: string[];
};

type Winner = {
  rank: number;
  wallet: string;
  name: string;
  score: number;
  amountSol: number;
};

type FinalizeRes = {
  ok: boolean;
  alreadyPaid?: boolean;
  payoutTxSigs?: string[];
  error?: string;
};

export default function AdminSuperPrizePage() {
  const [token, setToken] = useState("");
  const [prizePoolSol, setPrizePoolSol] = useState("5");
  const [entrySol, setEntrySol] = useState("0.1");
  const [durationHours, setDurationHours] = useState("48");
  const [event, setEvent] = useState<Event | null>(null);
  const [winners, setWinners] = useState<Winner[]>([]);
  const [msg, setMsg] = useState<string>("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const r = await fetch("/api/superprize/leaderboard", {
      cache: "no-store",
    }).catch(() => null);

    if (!r || !r.ok) {
      setEvent(null);
      setWinners([]);
      return;
    }

    const j = (await r.json().catch(() => null)) as {
      event?: Event | null;
      winners?: Winner[];
    } | null;

    setEvent(j?.event || null);
    setWinners(Array.isArray(j?.winners) ? j.winners : []);
  }

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.setTimeout(() => void refresh(), 0);
    const t = window.setInterval(() => void refresh(), 2500);
    return () => window.clearInterval(t);
  }, []);

  async function start() {
    if (!token.trim()) {
      setMsg("Missing admin token.");
      return;
    }

    setMsg("");
    setBusy(true);

    try {
      const r = await fetch("/api/admin/superprize/start", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-admin-token": token,
        },
        body: JSON.stringify({
          prizePoolSol: Number(prizePoolSol),
          entrySol: Number(entrySol),
          durationHours: Number(durationHours),
        }),
      }).catch(() => null);

      const j = (await r?.json().catch(() => null)) as {
        error?: string;
      } | null;

      if (!r || !r.ok) {
        setMsg(j?.error || "START_FAILED");
      } else {
        setMsg("Started.");
      }

      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function finalizeAndPay() {
    if (!token.trim()) {
      setMsg("Missing admin token.");
      return;
    }

    setMsg("");
    setBusy(true);

    try {
      const r = await fetch("/api/admin/superprize/finalize", {
        method: "POST",
        headers: { "x-admin-token": token },
      }).catch(() => null);

      const j = (await r?.json().catch(() => null)) as FinalizeRes | null;

      if (!r || !r.ok || !j?.ok) {
        setMsg(j?.error || "FINALIZE_FAILED");
      } else if (j.alreadyPaid) {
        setMsg("Event already finalized and paid.");
      } else {
        setMsg(
          `Finalized and paid${
            j.payoutTxSigs?.length ? ` (${j.payoutTxSigs.length} tx)` : ""
          }.`,
        );
      }

      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={wrap}>
      <div style={shell}>
        <div style={{ marginBottom: 12 }}>
          <Link href="/" style={homeBtn}>
            ⬅ Home
          </Link>
          <Link href="/superprize" style={{ ...homeBtn, marginLeft: 10 }}>
            🏆 SuperPrize
          </Link>
          <Link
            href="/history?tab=superprize"
            style={{ ...homeBtn, marginLeft: 10 }}
          >
            📜 History
          </Link>
        </div>

        <h1 style={h1}>🛠 Admin · SuperPrize</h1>

        <div style={card}>
          <div style={{ fontWeight: 900, marginBottom: 8 }}>Admin token</div>
          <input
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="SUPERPRIZE_ADMIN_TOKEN"
            style={input}
          />
          <div style={muted}>
            Stored in .env.local and sent via header <code>x-admin-token</code>.
          </div>
        </div>

        <div style={card}>
          <div style={{ fontWeight: 900, marginBottom: 8 }}>Start event</div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <label style={label}>
              Prize pool (SOL)
              <input
                value={prizePoolSol}
                onChange={(e) => setPrizePoolSol(e.target.value)}
                style={inputSm}
              />
            </label>

            <label style={label}>
              Entry (SOL)
              <input
                value={entrySol}
                onChange={(e) => setEntrySol(e.target.value)}
                style={inputSm}
              />
            </label>

            <label style={label}>
              Duration (hours)
              <input
                value={durationHours}
                onChange={(e) => setDurationHours(e.target.value)}
                style={inputSm}
              />
            </label>
          </div>

          <div
            style={{
              display: "flex",
              gap: 10,
              marginTop: 12,
              flexWrap: "wrap",
            }}
          >
            <button
              style={{ ...btn, opacity: token.trim() ? 1 : 0.55 }}
              onClick={() => void start()}
              disabled={busy || !token.trim()}
            >
              {busy ? "Working..." : "Start"}
            </button>

            <button
              style={{ ...btn, opacity: token.trim() ? 1 : 0.55 }}
              onClick={() => void finalizeAndPay()}
              disabled={busy || !token.trim()}
            >
              {busy ? "Working..." : "Finalize + Pay"}
            </button>

            <button style={btn} onClick={() => void refresh()} disabled={busy}>
              Refresh
            </button>
          </div>

          {msg && <div style={{ marginTop: 10, opacity: 0.9 }}>{msg}</div>}
        </div>

        <div style={card}>
          <div style={{ fontWeight: 900, marginBottom: 8 }}>Current event</div>

          {!event ? (
            <div style={muted}>No active event.</div>
          ) : (
            <div style={muted}>
              id: <b>{event.id}</b> · status: <b>{event.status}</b> · entry:{" "}
              <b>{event.entrySol.toFixed(3)}</b> · prize:{" "}
              <b>{event.prizePoolSol.toFixed(3)}</b> · entries:{" "}
              <b>{event.entriesCount}</b>
              <br />
              start: <b>{new Date(event.startAt).toLocaleString()}</b> · end:{" "}
              <b>{new Date(event.endAt).toLocaleString()}</b>
              <br />
              payout tx: <b>{event.payoutTxSigs?.length || 0}</b>
            </div>
          )}
        </div>

        {winners.length > 0 && (
          <div style={card}>
            <div style={{ fontWeight: 900, marginBottom: 8 }}>Winners</div>
            {winners.map((w) => (
              <div key={w.rank} style={row}>
                <span>
                  #{w.rank} <b>{w.name}</b> ({w.score})
                </span>
                <span>+{w.amountSol.toFixed(3)} SOL</span>
              </div>
            ))}
          </div>
        )}

        {!!event?.payoutTxSigs?.length && (
          <div style={card}>
            <div style={{ fontWeight: 900, marginBottom: 8 }}>Payout tx</div>
            {event.payoutTxSigs.map((sig) => (
              <a
                key={sig}
                href={`https://solscan.io/tx/${sig}`}
                target="_blank"
                rel="noreferrer"
                style={txRow}
              >
                {sig}
              </a>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

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

const h1: React.CSSProperties = { fontSize: 26, margin: "14px 0" };

const card: React.CSSProperties = {
  padding: 12,
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.15)",
  background: "rgba(255,255,255,0.06)",
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

const muted: React.CSSProperties = { opacity: 0.75, fontSize: 13 };

const input: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.18)",
  background: "rgba(255,255,255,0.06)",
  color: "white",
  outline: "none",
  fontWeight: 700,
};

const inputSm: React.CSSProperties = { ...input, width: 140 };

const label: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  fontWeight: 800,
};

const btn: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.2)",
  background: "rgba(255,255,255,0.14)",
  color: "white",
  cursor: "pointer",
  fontWeight: 900,
};

const row: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(255,255,255,0.03)",
  marginTop: 8,
};

const txRow: React.CSSProperties = {
  display: "block",
  marginTop: 8,
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(255,255,255,0.03)",
  color: "white",
  textDecoration: "none",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: 12,
  overflowWrap: "anywhere",
};
