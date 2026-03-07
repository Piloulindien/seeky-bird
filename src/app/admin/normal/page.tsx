"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type NormalRound = {
  id: number;
  status: "live" | "locked" | "settled";
  createdAt: number;
  lockedAt: number | null;
  settledAt: number | null;
  poolSol: number;
  entriesCount: number;
};

type NormalStatusResponse = {
  round: NormalRound;
  settlingRoundId: number | null;
  settleInMs: number | null;
  graceMs: number;
};

type NormalTopRow = { wallet: string; name: string; score: number };

type NormalTopRes = {
  ok: boolean;
  roundId: number;
  top: NormalTopRow[];
};

type NormalHistItem = {
  at: number;
  roundId: number;
  payoutTxSigs?: string[];
};

type NormalHistoryRes = {
  items: NormalHistItem[];
  limit: number;
  offset: number;
};

type NormalPayoutRes = {
  ok: boolean;
  roundId?: number;
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

function safeNum(x: unknown, fallback = 0): number {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

export default function AdminNormalPage() {
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<NormalStatusResponse | null>(null);
  const [top10, setTop10] = useState<Array<{ name: string; score: number }>>(
    [],
  );
  const [recent, setRecent] = useState<NormalHistItem[]>([]);
  const [msg, setMsg] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [payingRoundId, setPayingRoundId] = useState<number | null>(null);

  const currentRoundId = useMemo(
    () => Number(status?.round?.id || 0),
    [status],
  );

  async function refresh() {
    setLoading(true);

    try {
      const stR = await fetch("/api/normal/status", {
        cache: "no-store",
      }).catch(() => null);

      if (!stR || !stR.ok) {
        setStatus(null);
        setTop10([]);
        setRecent([]);
        return;
      }

      const stJ = (await stR
        .json()
        .catch(() => null)) as NormalStatusResponse | null;

      if (!stJ?.round?.id) {
        setStatus(null);
        setTop10([]);
        setRecent([]);
        return;
      }

      setStatus(stJ);

      const rid = Number(stJ.round.id || 0);

      const [topR, histR] = await Promise.all([
        fetch(
          `/api/normal/leaderboard?round=${encodeURIComponent(String(rid))}`,
          { cache: "no-store" },
        ).catch(() => null),
        fetch(`/api/normal/history?limit=20&offset=0`, {
          cache: "no-store",
        }).catch(() => null),
      ]);

      if (topR && topR.ok) {
        const topJ = (await topR
          .json()
          .catch(() => null)) as NormalTopRes | null;
        const rows = topJ?.ok && Array.isArray(topJ.top) ? topJ.top : [];
        setTop10(
          rows.slice(0, 10).map((x) => ({
            name: String(x.name || ""),
            score: safeNum(x.score, 0),
          })),
        );
      } else {
        setTop10([]);
      }

      if (histR && histR.ok) {
        const histJ = (await histR
          .json()
          .catch(() => null)) as NormalHistoryRes | null;

        const items = Array.isArray(histJ?.items) ? histJ.items : [];
        setRecent(
          items.map((x) => ({
            at: safeNum(x.at, 0),
            roundId: safeNum(x.roundId, 0),
            payoutTxSigs: Array.isArray(x.payoutTxSigs) ? x.payoutTxSigs : [],
          })),
        );
      } else {
        setRecent([]);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.setTimeout(() => void refresh(), 0);
    const t = window.setInterval(() => void refresh(), 3000);
    return () => window.clearInterval(t);
  }, []);

  const settleText = useMemo(() => {
    const ms = status?.settleInMs ?? null;
    if (ms == null) return "—";
    const s = Math.max(0, Math.ceil(ms / 1000));
    return `${s}s`;
  }, [status]);

  async function payRound(roundId: number) {
    if (!roundId) {
      setMsg("Missing roundId.");
      return;
    }

    if (!token.trim()) {
      setMsg("Missing admin token.");
      return;
    }

    setMsg("");
    setPayingRoundId(roundId);

    try {
      const r = await fetch("/api/admin/normal/payout", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-admin-token": token,
        },
        body: JSON.stringify({ roundId }),
      }).catch(() => null);

      const j = (await r?.json().catch(() => null)) as NormalPayoutRes | null;

      if (!r || !r.ok || !j?.ok) {
        setMsg(j?.error || "NORMAL_PAYOUT_FAILED");
        return;
      }

      if (j.alreadyPaid) {
        setMsg(`Round #${roundId} already paid.`);
      } else {
        setMsg(
          `Round #${roundId} paid successfully${
            j.payoutTxSigs?.length ? ` (${j.payoutTxSigs.length} tx)` : ""
          }.`,
        );
      }

      await refresh();
    } finally {
      setPayingRoundId(null);
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
            href="/leaderboard?tab=normal"
            style={{ ...homeBtn, marginLeft: 10 }}
          >
            🏆 Leaderboard
          </Link>
          <Link
            href="/history?tab=normal"
            style={{ ...homeBtn, marginLeft: 10 }}
          >
            📜 History
          </Link>
        </div>

        <h1 style={h1}>🛠 Admin · Normal</h1>

        <div style={card}>
          <div style={{ fontWeight: 900, marginBottom: 8 }}>Admin token</div>
          <input
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="SUPERPRIZE_ADMIN_TOKEN"
            style={input}
          />
          <div style={muted}>
            Utilisé pour appeler <code>/api/admin/normal/payout</code>.
          </div>
        </div>

        <div style={card}>
          <div style={{ fontWeight: 900, marginBottom: 8 }}>Current round</div>

          {!status ? (
            <div style={muted}>{loading ? "Loading…" : "No data."}</div>
          ) : (
            <div style={muted}>
              id: <b>#{status.round.id}</b> · status:{" "}
              <b>{status.round.status}</b> · pool:{" "}
              <b>{Number(status.round.poolSol || 0).toFixed(3)} SOL</b> ·
              entries: <b>{status.round.entriesCount}</b>
              <br />
              created: <b>{fmtDT(status.round.createdAt)}</b> · locked:{" "}
              <b>
                {status.round.lockedAt ? fmtDT(status.round.lockedAt) : "—"}
              </b>{" "}
              · settled:{" "}
              <b>
                {status.round.settledAt ? fmtDT(status.round.settledAt) : "—"}
              </b>{" "}
              · settle in: <b>{settleText}</b>
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

            <button
              style={{
                ...btn,
                opacity: token.trim() && currentRoundId ? 1 : 0.55,
              }}
              disabled={
                !token.trim() || !currentRoundId || payingRoundId !== null
              }
              onClick={() => void payRound(currentRoundId)}
            >
              {payingRoundId === currentRoundId
                ? "Paying..."
                : "Pay current round"}
            </button>
          </div>

          {msg && <div style={{ marginTop: 10, opacity: 0.9 }}>{msg}</div>}
        </div>

        <div style={card}>
          <div style={{ fontWeight: 900, marginBottom: 8 }}>Top 10 (live)</div>

          {top10.length === 0 ? (
            <div style={muted}>No scores.</div>
          ) : (
            top10.map((p, i) => (
              <div key={`${p.name}-${p.score}-${i}`} style={row}>
                <span>
                  #{i + 1} <b>{p.name}</b>
                </span>
                <span>{p.score}</span>
              </div>
            ))
          )}
        </div>

        <div style={card}>
          <div style={{ fontWeight: 900, marginBottom: 8 }}>
            Recent distributions
          </div>

          {recent.length === 0 ? (
            <div style={muted}>No payouts yet.</div>
          ) : (
            recent.map((d) => (
              <div key={`${d.roundId}-${d.at}`} style={distWrap}>
                <Link
                  href={`/leaderboard?tab=normal&round=${encodeURIComponent(String(d.roundId))}`}
                  style={{ ...row, textDecoration: "none", color: "white" }}
                >
                  <span>
                    Round <b>#{d.roundId}</b>
                  </span>
                  <span style={{ opacity: 0.85 }}>{fmtDT(d.at)}</span>
                </Link>

                <div style={distActions}>
                  <button
                    style={{ ...btnSmall, opacity: token.trim() ? 1 : 0.55 }}
                    disabled={!token.trim() || payingRoundId !== null}
                    onClick={() => void payRound(d.roundId)}
                  >
                    {payingRoundId === d.roundId ? "Paying..." : "Pay"}
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
