"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type DailyTopRow = { wallet: string; name: string; score: number };

type DailyDayState = {
  day: string;
  status: "open" | "settled";
  createdAt: number;
  settledAt: number | null;
  poolSol: number;
  entriesCount: number;
};

type DailyStatusResponse = {
  day: DailyDayState;
  top3: DailyTopRow[];
};

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
  top3Snapshot?: DailyTopRow[];
};

type DailyHistoryResponse = {
  ok: boolean;
  items: DailyDistribution[];
  limit: number;
  offset: number;
};

type DailyPayoutRes = {
  ok: boolean;
  day?: string;
  alreadyPaid?: boolean;
  payoutTxSigs?: string[];
  error?: string;
};

function fmtDT(ms: number): string {
  if (!ms) return "—";
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return "—";
  }
}

export default function AdminDailyPage() {
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<DailyStatusResponse | null>(null);
  const [history, setHistory] = useState<DailyDistribution[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [payingDay, setPayingDay] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);

    try {
      const [stR, histR] = await Promise.all([
        fetch("/api/daily/status", { cache: "no-store" }).catch(() => null),
        fetch("/api/daily/history?limit=25&offset=0", {
          cache: "no-store",
        }).catch(() => null),
      ]);

      if (stR && stR.ok) {
        const stJ = (await stR
          .json()
          .catch(() => null)) as DailyStatusResponse | null;
        setStatus(stJ?.day?.day ? stJ : null);
      } else {
        setStatus(null);
      }

      if (histR && histR.ok) {
        const histJ = (await histR
          .json()
          .catch(() => null)) as DailyHistoryResponse | null;
        const items = Array.isArray(histJ?.items) ? histJ.items : [];
        setHistory(items);
      } else {
        setHistory([]);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.setTimeout(() => void refresh(), 0);
    const t = window.setInterval(() => void refresh(), 3500);
    return () => window.clearInterval(t);
  }, []);

  const today = useMemo(() => status?.day?.day || "", [status]);

  async function payDay(day: string) {
    const d = String(day || "").trim();

    if (!d) {
      setMsg("Missing day.");
      return;
    }

    if (!token.trim()) {
      setMsg("Missing admin token.");
      return;
    }

    setMsg("");
    setPayingDay(d);

    try {
      const r = await fetch("/api/admin/daily/payout", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-admin-token": token,
        },
        body: JSON.stringify({ day: d }),
      }).catch(() => null);

      const j = (await r?.json().catch(() => null)) as DailyPayoutRes | null;

      if (!r || !r.ok || !j?.ok) {
        setMsg(j?.error || "DAILY_PAYOUT_FAILED");
        return;
      }

      if (j.alreadyPaid) {
        setMsg(`Day ${d} already paid.`);
      } else {
        setMsg(
          `Day ${d} paid successfully${
            j.payoutTxSigs?.length ? ` (${j.payoutTxSigs.length} tx)` : ""
          }.`,
        );
      }

      await refresh();
    } finally {
      setPayingDay(null);
    }
  }

  return (
    <main style={wrap}>
      <div style={shell}>
        <div style={{ marginBottom: 12 }}>
          <Link href="/" style={homeBtn}>
            ⬅ Home
          </Link>
          <Link href="/admin" style={{ ...homeBtn, marginLeft: 10 }}>
            🛠 Admin
          </Link>
          <Link
            href="/leaderboard?tab=daily"
            style={{ ...homeBtn, marginLeft: 10 }}
          >
            🏆 Leaderboard
          </Link>
          <Link
            href="/history?tab=daily"
            style={{ ...homeBtn, marginLeft: 10 }}
          >
            📜 History
          </Link>
        </div>

        <h1 style={h1}>🛠 Admin · Daily</h1>

        <div style={card}>
          <div style={{ fontWeight: 900, marginBottom: 8 }}>Admin token</div>
          <input
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="SUPERPRIZE_ADMIN_TOKEN"
            style={input}
          />
          <div style={muted}>
            Utilisé pour appeler <code>/api/admin/daily/payout</code>.
          </div>
        </div>

        <div style={card}>
          <div style={{ fontWeight: 900, marginBottom: 8 }}>Today</div>

          {!status ? (
            <div style={muted}>{loading ? "Loading…" : "No data."}</div>
          ) : (
            <div style={muted}>
              day: <b>{status.day.day}</b> · status: <b>{status.day.status}</b>{" "}
              · pool: <b>{Number(status.day.poolSol || 0).toFixed(3)} SOL</b> ·
              entries: <b>{status.day.entriesCount}</b>
              <br />
              created: <b>{fmtDT(status.day.createdAt)}</b> · settled:{" "}
              <b>{status.day.settledAt ? fmtDT(status.day.settledAt) : "—"}</b>
            </div>
          )}

          <div
            style={{
              display: "flex",
              gap: 10,
              marginTop: 12,
              flexWrap: "wrap",
            }}
          >
            <button
              style={btn}
              onClick={() => void refresh()}
              disabled={loading}
            >
              Refresh
            </button>

            {today ? (
              <button
                style={{ ...btn, opacity: token.trim() ? 1 : 0.55 }}
                disabled={!token.trim() || payingDay !== null}
                onClick={() => void payDay(today)}
              >
                {payingDay === today ? "Paying..." : "Pay selected day"}
              </button>
            ) : null}

            {today ? (
              <Link
                href={`/leaderboard?tab=daily&day=${encodeURIComponent(today)}`}
                style={btnLink}
              >
                Open today leaderboard →
              </Link>
            ) : null}
          </div>

          {msg && <div style={{ marginTop: 10, opacity: 0.9 }}>{msg}</div>}
        </div>

        <div style={card}>
          <div style={{ fontWeight: 900, marginBottom: 8 }}>
            Archives (settled days)
          </div>

          {history.length === 0 ? (
            <div style={muted}>No settled distributions yet.</div>
          ) : (
            history.map((d) => (
              <div key={d.date} style={distWrap}>
                <Link
                  href={`/leaderboard?tab=daily&day=${encodeURIComponent(d.date)}`}
                  style={{ ...row, textDecoration: "none", color: "white" }}
                >
                  <span>
                    <b>{d.date}</b>
                  </span>
                  <span style={{ opacity: 0.85 }}>
                    {Number(d.poolSol || 0).toFixed(3)} SOL
                  </span>
                </Link>

                <div style={distActions}>
                  <button
                    style={{ ...btnSmall, opacity: token.trim() ? 1 : 0.55 }}
                    disabled={!token.trim() || payingDay !== null}
                    onClick={() => void payDay(d.date)}
                  >
                    {payingDay === d.date ? "Paying..." : "Pay"}
                  </button>

                  <div style={mutedInline}>
                    tx: {d.payoutTxSigs?.length ? d.payoutTxSigs.length : 0}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
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

const btn: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.2)",
  background: "rgba(255,255,255,0.14)",
  color: "white",
  cursor: "pointer",
  fontWeight: 900,
};

const btnSmall: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.2)",
  background: "rgba(255,255,255,0.14)",
  color: "white",
  cursor: "pointer",
  fontWeight: 900,
  fontSize: 12,
};

const btnLink: React.CSSProperties = {
  ...btn,
  textDecoration: "none",
  display: "inline-block",
};

const muted: React.CSSProperties = { opacity: 0.75, fontSize: 13 };
const mutedInline: React.CSSProperties = { opacity: 0.75, fontSize: 12 };

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

const row: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(255,255,255,0.03)",
  marginTop: 8,
};

const distWrap: React.CSSProperties = {
  marginTop: 8,
};

const distActions: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  marginTop: 8,
};
