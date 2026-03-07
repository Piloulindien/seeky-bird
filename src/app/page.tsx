"use client";

import type React from "react";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { ECONOMY } from "../lib/economy";

import {
  canSpinToday,
  shouldAutoOpenSpin,
  getPendingSpin,
  spinOnce,
  claimSpin,
} from "../lib/spin";

import {
  fetchSuperprizeStatus,
  fetchSuperprizeLeaderboardTop3,
  isEventLive,
} from "../lib/superprize";

import { connectWallet, getConnectedWalletPubkey } from "../lib/wallet";

/* ---------------- helpers ---------------- */

function msToNextUtcMidnight(nowMs: number) {
  const d = new Date(nowMs);
  const end = Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate() + 1,
    0,
    0,
    0,
    0,
  );
  return end - nowMs;
}

function clampMin0(n: number) {
  return n < 0 ? 0 : n;
}

function safeNum(x: unknown, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

/** same wallet logic as play/page.tsx (must match your consume wallet) */
function getWalletId(): string {
  if (typeof window === "undefined") return "local_unknown";

  const w = (localStorage.getItem("seeky_wallet") || "").trim();
  if (w) return w;

  const key = "seeky_wallet_fallback_v1";
  const existing = localStorage.getItem(key);
  if (existing) return existing;

  const nw = `local_${Math.random().toString(36).slice(2, 12)}`;
  localStorage.setItem(key, nw);
  return nw;
}

/* Spin math */
const SEGMENTS = [1, 2, 3, 4, 5] as const;
type SegmentValue = (typeof SEGMENTS)[number];

const SEG = 360 / SEGMENTS.length;
const START_DEG = -90;

function segCenterDeg(index: number) {
  return index * SEG + SEG / 2;
}

/** compact inline: "Top 3: 10 - 8 - 4" (scores only) */
function Top3CompactInline({
  scores,
}: {
  scores: Array<number | null | undefined>;
}) {
  const a = typeof scores[0] === "number" ? scores[0] : null;
  const b = typeof scores[1] === "number" ? scores[1] : null;
  const c = typeof scores[2] === "number" ? scores[2] : null;

  return (
    <div style={compactLine}>
      <span style={compactLabel}>Top 3:</span>
      <span style={compactNums}>
        {a == null ? "—" : a} <span style={compactSep}>-</span>
        {b == null ? "—" : b} <span style={compactSep}>-</span>
        {c == null ? "—" : c}
      </span>
    </div>
  );
}

/* ---------------- types (HOME) ---------------- */

type NormalStatusResponse = {
  round: {
    id: number;
    status: "live" | "locked" | "settled";
    createdAt: number;
    lockedAt: number | null;
    settledAt: number | null;
    poolSol: number;
    entriesCount: number;
  };
  settlingRoundId: number | null;
  settleInMs: number | null;
  graceMs: number;
};

type NormalTopRes = {
  ok: boolean;
  roundId: number;
  top: Array<{ wallet: string; name: string; score: number }>;
};

/** Daily comes from /api/daily/status */
type DailyStatusResponse = {
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

type DailyUiState = {
  loaded: boolean;
  ok: boolean;
  day: string;
  entrySol: number;
  poolSol: number;
  entries: number;
};

type RunsState = {
  free: number;
  normalPaid: number;
  dailyPaid: number;
  superprizePaid: number;
};

type RunsStatusRes =
  | { ok: true; wallet?: string; state?: RunsState; remaining?: RunsState }
  | { ok: true; wallet?: string }
  | { ok: false; error?: string }
  | Record<string, unknown>;

function toRunsState(x: unknown): RunsState {
  const o =
    x && typeof x === "object"
      ? (x as Record<string, unknown>)
      : ({} as Record<string, unknown>);

  return {
    free: Math.max(0, Math.floor(Number(o.free ?? 0))),
    normalPaid: Math.max(0, Math.floor(Number(o.normalPaid ?? 0))),
    dailyPaid: Math.max(0, Math.floor(Number(o.dailyPaid ?? 0))),
    superprizePaid: Math.max(0, Math.floor(Number(o.superprizePaid ?? 0))),
  };
}

async function fetchRunsFromDb(wallet: string): Promise<number | null> {
  const r = await fetch(
    `/api/runs/status?wallet=${encodeURIComponent(wallet)}`,
    { cache: "no-store" },
  ).catch(() => null);

  if (!r || !r.ok) return null;

  const j = (await r.json().catch(() => null)) as RunsStatusRes | null;
  if (!j || typeof j !== "object") return null;

  const obj = j as Record<string, unknown>;
  const ok = obj.ok;

  if (ok === false) return null;

  const candidate = (obj.state as unknown) ?? (obj.remaining as unknown) ?? obj;

  const s = toRunsState(candidate);
  const total = s.free + s.normalPaid + s.dailyPaid + s.superprizePaid;
  return Number.isFinite(total) ? total : null;
}

/** credits FREE runs to DB (usable in any mode) */
async function grantFreeRuns(wallet: string, amount: number) {
  const r = await fetch("/api/admin/grant-runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ wallet, amount, kind: "free" }),
    cache: "no-store",
  }).catch(() => null);

  if (!r) return { ok: false as const, error: "NETWORK" };

  const j = (await r.json().catch(() => null)) as {
    ok?: boolean;
    error?: string;
  } | null;

  if (!j?.ok) return { ok: false as const, error: j?.error || "GRANT_FAILED" };
  return { ok: true as const };
}

/* ---------------- polling utils ---------------- */

function isPageVisible(): boolean {
  if (typeof document === "undefined") return true;
  return document.visibilityState !== "hidden";
}

export default function Home() {
  function fmtMs(ms: number) {
    if (ms <= 0) return "0:00";
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const ss = String(s % 60).padStart(2, "0");
    const h = Math.floor(m / 60);
    const mm = String(m % 60).padStart(2, "0");
    return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
  }

  const [walletPk, setWalletPk] = useState<string | null>(null);

  // runs + spin
  const [runs, setRuns] = useState(0);
  const [pendingRuns, setPendingRuns] = useState(0);
  const [spinOpen, setSpinOpen] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const [wheelDeg, setWheelDeg] = useState(0);
  const [showSpinConfetti, setShowSpinConfetti] = useState(false);

  // compute spin availability in state (avoid SSR/hydration mismatch)
  const [spinAvailable, setSpinAvailable] = useState(false);

  // server normal
  const [normal, setNormal] = useState<NormalStatusResponse | null>(null);
  const [normalMini, setNormalMini] = useState<{
    loaded: boolean;
    top1: number | null;
    top10: number | null;
    open: boolean;
  }>({ loaded: false, top1: null, top10: null, open: false });

  // daily status (server)
  const [daily, setDaily] = useState<DailyUiState>({
    loaded: false,
    ok: false,
    day: "",
    entrySol: ECONOMY.entrySol,
    poolSol: 0,
    entries: 0,
  });
  const [dailyTop3Scores, setDailyTop3Scores] = useState<number[]>([]);

  // time
  const [now, setNow] = useState(0);

  // superprize
  const [superStatus, setSuperStatus] = useState<{
    hasEvent: boolean;
    live: boolean;
    prizePoolSol: number;
    entrySol: number;
    endsInMs: number | null;
  }>({
    hasEvent: false,
    live: false,
    prizePoolSol: 0,
    entrySol: 0.01,
    endsInMs: null,
  });
  const [superTop3Scores, setSuperTop3Scores] = useState<number[]>([]);

  const dailyTimeLeft = useMemo(() => msToNextUtcMidnight(now), [now]);

  /* ---------------- clock tick (1Hz) ---------------- */
  useEffect(() => {
    if (typeof window === "undefined") return;

    const t0 = window.setTimeout(() => setNow(Date.now()), 0);
    const t = window.setInterval(() => setNow(Date.now()), 1000);

    return () => {
      window.clearTimeout(t0);
      window.clearInterval(t);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const syncWallet = () => {
      setWalletPk(getConnectedWalletPubkey());
    };

    syncWallet();
    window.addEventListener("seeky:wallet", syncWallet);

    return () => {
      window.removeEventListener("seeky:wallet", syncWallet);
    };
  }, []);

  /* ---------------- runs + spin refresh (events only; no interval) ---------------- */
  useEffect(() => {
    if (typeof window === "undefined") return;

    let alive = true;

    const recompute = async () => {
      const p = Math.max(0, Number(getPendingSpin() || 0));
      setPendingRuns(p);

      setSpinAvailable(Boolean(canSpinToday() || p > 0));

      const wallet = getWalletId();
      const dbRuns = await fetchRunsFromDb(wallet);
      if (!alive) return;

      if (dbRuns != null) setRuns(dbRuns);
    };

    void recompute();

    window.addEventListener("seeky:update", recompute);
    window.addEventListener("storage", recompute);

    return () => {
      alive = false;
      window.removeEventListener("seeky:update", recompute);
      window.removeEventListener("storage", recompute);
    };
  }, []);

  /* ---------------- auto open spin ---------------- */
  useEffect(() => {
    if (typeof window === "undefined") return;

    const pending = Math.max(0, Number(getPendingSpin() || 0));
    if (pending > 0) {
      const t = window.setTimeout(() => {
        setPendingRuns(pending);
        setSpinOpen(true);
      }, 0);
      return () => window.clearTimeout(t);
    }

    if (shouldAutoOpenSpin()) {
      const t = window.setTimeout(() => {
        const p2 = Math.max(0, Number(getPendingSpin() || 0));
        setPendingRuns(p2);
        setSpinOpen(true);
      }, 0);
      return () => window.clearTimeout(t);
    }
  }, []);

  /* ---------------- NORMAL polling ---------------- */
  useEffect(() => {
    if (typeof window === "undefined") return;

    let alive = true;
    let statusInFlight = false;
    let lbInFlight = false;

    const fetchStatus = async () => {
      if (!alive || !isPageVisible() || statusInFlight) return;

      statusInFlight = true;
      try {
        const r = await fetch("/api/normal/status", { cache: "no-store" });
        if (!r.ok) return;

        const st = (await r
          .json()
          .catch(() => null)) as NormalStatusResponse | null;
        if (!alive || !st?.round?.id) return;

        setNormal(st);
      } catch {
        // keep last UI
      } finally {
        statusInFlight = false;
      }
    };

    const fetchLeaderboardMini = async () => {
      if (!alive || !isPageVisible() || lbInFlight) return;

      const ridNum = Number(normal?.round?.id || 0);
      if (!ridNum) {
        setNormalMini({ loaded: true, top1: null, top10: null, open: false });
        return;
      }

      lbInFlight = true;
      try {
        const rid = String(ridNum);
        const r2 = await fetch(
          `/api/normal/leaderboard?round=${encodeURIComponent(rid)}`,
          { cache: "no-store" },
        );

        if (!r2.ok) {
          setNormalMini({ loaded: true, top1: null, top10: null, open: false });
          return;
        }

        const top = (await r2.json().catch(() => null)) as NormalTopRes | null;
        if (!alive || !top?.ok) return;

        const rows = Array.isArray(top.top) ? top.top : [];
        const top1 = rows.length > 0 ? safeNum(rows[0].score, 0) : null;

        if (rows.length >= 10) {
          const cutoff = safeNum(rows[9].score, 0);
          setNormalMini({ loaded: true, top1, top10: cutoff, open: false });
        } else {
          setNormalMini({ loaded: true, top1, top10: null, open: true });
        }
      } catch {
        // keep last UI
      } finally {
        lbInFlight = false;
      }
    };

    void fetchStatus().then(() => void fetchLeaderboardMini());

    const tStatus = window.setInterval(fetchStatus, 10_000);
    const tLb = window.setInterval(fetchLeaderboardMini, 30_000);

    const onVis = () => {
      if (!alive) return;
      if (isPageVisible()) {
        void fetchStatus().then(() => void fetchLeaderboardMini());
      }
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      alive = false;
      window.clearInterval(tStatus);
      window.clearInterval(tLb);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [normal?.round?.id]);

  /* ---------------- DAILY polling ---------------- */
  useEffect(() => {
    if (typeof window === "undefined") return;

    let alive = true;
    let inFlight = false;

    const tick = async () => {
      if (!alive || !isPageVisible() || inFlight) return;

      inFlight = true;
      try {
        const r = await fetch("/api/daily/status", { cache: "no-store" });
        if (!r.ok) {
          if (!alive) return;
          setDaily((prev) => ({ ...prev, loaded: true, ok: false }));
          setDailyTop3Scores([]);
          return;
        }

        const st = (await r
          .json()
          .catch(() => null)) as DailyStatusResponse | null;
        if (!alive || !st?.day?.day) return;

        setDaily({
          loaded: true,
          ok: true,
          day: st.day.day,
          entrySol: ECONOMY.entrySol,
          poolSol: safeNum(st.day.poolSol, 0),
          entries: Math.max(0, Number(st.day.entriesCount || 0)),
        });

        const top3 = Array.isArray(st.top3) ? st.top3.slice(0, 3) : [];
        setDailyTop3Scores(top3.map((x) => safeNum(x.score, 0)));
      } catch {
        if (!alive) return;
        setDaily((prev) => ({ ...prev, loaded: true, ok: false }));
        setDailyTop3Scores([]);
      } finally {
        inFlight = false;
      }
    };

    void tick();
    const t = window.setInterval(tick, 15_000);

    const onVis = () => {
      if (!alive) return;
      if (isPageVisible()) void tick();
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      alive = false;
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  /* ---------------- SUPERPRIZE polling ---------------- */
  useEffect(() => {
    if (typeof window === "undefined") return;

    let alive = true;
    let statusInFlight = false;
    let lbInFlight = false;

    const fetchStatus = async () => {
      if (!alive || !isPageVisible() || statusInFlight) return;

      statusInFlight = true;
      try {
        const st = await fetchSuperprizeStatus();
        if (!alive) return;

        const ev = st?.event ?? null;
        if (!ev) {
          setSuperStatus({
            hasEvent: false,
            live: false,
            prizePoolSol: 0,
            entrySol: 0.01,
            endsInMs: null,
          });
          setSuperTop3Scores([]);
          return;
        }

        const live = isEventLive(ev);

        setSuperStatus({
          hasEvent: true,
          live,
          prizePoolSol: ev.prizePoolSol ?? 0,
          entrySol: ev.entrySol ?? 0.01,
          endsInMs: Math.max(0, (ev.endAt ?? 0) - Date.now()),
        });
      } catch {
        // keep last UI
      } finally {
        statusInFlight = false;
      }
    };

    const fetchLeaderboard = async () => {
      if (!alive || !isPageVisible() || lbInFlight) return;
      if (!superStatus.hasEvent) return;

      lbInFlight = true;
      try {
        const top3 = await fetchSuperprizeLeaderboardTop3();
        if (!alive) return;

        setSuperTop3Scores(
          (top3 ?? []).slice(0, 3).map((r) => safeNum(r.score, 0)),
        );
      } catch {
        // keep last UI
      } finally {
        lbInFlight = false;
      }
    };

    void fetchStatus().then(() => void fetchLeaderboard());

    const tStatus = window.setInterval(fetchStatus, 10_000);
    const tLb = window.setInterval(fetchLeaderboard, 30_000);

    const onVis = () => {
      if (!alive) return;
      if (isPageVisible()) {
        void fetchStatus().then(() => void fetchLeaderboard());
      }
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      alive = false;
      window.clearInterval(tStatus);
      window.clearInterval(tLb);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [superStatus.hasEvent]);

  const pool = normal?.round ? safeNum(normal.round.poolSol, 0) : 0;
  const thresholdSol = ECONOMY.thresholdSol;

  const nextPayoutInEntries = useMemo(() => {
    const remaining = thresholdSol - pool;
    if (remaining <= 0) return 0;

    const perEntryToRewardsPool = ECONOMY.entrySol * ECONOMY.take.rewards;
    if (perEntryToRewardsPool <= 0) return 0;

    return Math.ceil(remaining / perEntryToRewardsPool);
  }, [pool, thresholdSol]);

  return (
    <main style={wrap}>
      <div style={shell}>
        {/* Header */}
        <header style={header}>
          <div style={headerTop}>
            <div style={brandBlock}>
              <div style={title}>Seeky Bird</div>
              <div style={subtitle}>Arcade runner · Pools · Tournaments</div>
            </div>

            <div style={headerRight}>
              <div style={runsBadge}>
                Runs{" "}
                <b style={{ fontVariantNumeric: "tabular-nums" }}>{runs}</b>
              </div>

              <div style={headerActions}>
                <button
                  style={headerActionBtn}
                  onClick={async () => {
                    const pk = await connectWallet();
                    if (!pk) {
                      alert("Wallet connection failed");
                      return;
                    }
                    setWalletPk(pk);
                  }}
                >
                  <span style={buttonTextClamp}>
                    {walletPk
                      ? `${walletPk.slice(0, 4)}...${walletPk.slice(-4)}`
                      : "Connect Wallet"}
                  </span>
                </button>

                <Link href="/play?mode=training" style={headerActionBtn}>
                  <span style={buttonTextClamp}>🎯 Training</span>
                </Link>

                <button
                  style={{
                    ...headerActionBtn,
                    opacity: spinAvailable ? 1 : 0.45,
                    cursor: spinAvailable ? "pointer" : "not-allowed",
                  }}
                  disabled={!spinAvailable}
                  onClick={() => {
                    if (!spinAvailable) return;
                    const pending = Math.max(0, Number(getPendingSpin() || 0));
                    setPendingRuns(pending);
                    setSpinOpen(true);
                  }}
                >
                  <span style={buttonTextClamp}>🎡 Spin</span>
                </button>
              </div>
            </div>
          </div>
        </header>

        {/* Normal pool */}
        <section style={card}>
          <div style={cardHeaderRow}>
            <div style={cardTitle}>Normal Pool</div>
            <Link href="/play?mode=normal" style={ctaBtn}>
              ▶ Play Normal
            </Link>
          </div>

          <div style={line}>
            Pool:{" "}
            <b>
              {pool.toFixed(3)} / {thresholdSol.toFixed(3)} SOL
            </b>
          </div>

          <div style={pillRow}>
            <div style={pill}>
              Next payout in <b>{clampMin0(nextPayoutInEntries)}</b> paid
              entries
            </div>
            <div style={pillMuted}>
              Round <b>{normal?.round?.id ? `#${normal.round.id}` : "—"}</b>
            </div>
          </div>

          <div style={pillRow}>
            <div style={miniPill}>
              Top 1:{" "}
              <b>
                {!normalMini.loaded || normalMini.top1 == null
                  ? "—"
                  : normalMini.top1}
              </b>
            </div>
            <div style={miniPillMuted}>
              Top 10:{" "}
              <b>
                {!normalMini.loaded
                  ? "—"
                  : normalMini.open
                    ? "open"
                    : normalMini.top10 == null
                      ? "—"
                      : normalMini.top10}
              </b>
            </div>
          </div>

          {thresholdSol > 0 && pool / thresholdSol >= 0.8 && (
            <div style={hintBlue}>Payout soon 👀</div>
          )}
        </section>

        {/* Daily Tournament */}
        <section style={card}>
          <div style={cardHeaderRow}>
            <div style={cardTitle}>Daily Tournament</div>
            <Link href="/play?mode=daily" style={ctaBtn}>
              ▶ Play Daily
            </Link>
          </div>

          {!daily.loaded ? (
            <div style={subline}>Loading…</div>
          ) : !daily.ok ? (
            <div style={subline}>
              Daily status unavailable (API). Check `/api/daily/status`.
            </div>
          ) : (
            <>
              <div style={line}>
                Entry: <b>{daily.entrySol.toFixed(2)} SOL</b> · Resets daily
              </div>

              <div style={subline}>
                Ends in <b>{fmtMs(dailyTimeLeft)}</b> (UTC)
              </div>

              <div style={subline}>
                Pool: <b>{daily.poolSol.toFixed(3)} SOL</b>
                {daily.entries > 0 ? (
                  <>
                    {" "}
                    · Entries <b>{daily.entries}</b>
                  </>
                ) : null}
              </div>

              <div style={{ marginTop: 12 }}>
                <Top3CompactInline scores={dailyTop3Scores} />
              </div>
            </>
          )}
        </section>

        {/* SuperPrize */}
        {superStatus.hasEvent && (
          <section style={card}>
            <div style={cardHeaderRow}>
              <div style={cardTitle}>SuperPrize</div>

              {superStatus.live ? (
                <Link href="/play?mode=superprize" style={ctaBtn}>
                  ▶ Play SuperPrize
                </Link>
              ) : (
                <div style={ctaBtnDisabled}>Not active</div>
              )}
            </div>

            <div style={line}>
              Prize pool: <b>{superStatus.prizePoolSol.toFixed(3)} SOL</b> ·
              Entry <b>{superStatus.entrySol.toFixed(2)} SOL</b>
            </div>

            <div style={subline}>
              {superStatus.endsInMs == null ? (
                <>
                  Status: <b>{superStatus.live ? "live" : "inactive"}</b>
                </>
              ) : superStatus.live ? (
                <>
                  Ends in <b>{fmtMs(superStatus.endsInMs)}</b>
                </>
              ) : (
                <>
                  Status: <b>inactive</b>
                </>
              )}
            </div>

            <div style={{ marginTop: 12 }}>
              <Top3CompactInline scores={superTop3Scores} />
            </div>
          </section>
        )}

        {/* Footer nav */}
        <nav style={navGrid}>
          <Link href="/leaderboard" style={navBtn}>
            🏆 Leaderboard
          </Link>
          <Link href="/rewards" style={navBtn}>
            💰 Rewards
          </Link>
          <Link href="/rules" style={navBtn}>
            📜 Rules
          </Link>
          <Link href="/history" style={navBtn}>
            📜 History
          </Link>
        </nav>
      </div>

      {/* Spin modal */}
      {spinOpen && (
        <div style={spinOverlay}>
          <div style={spinModal}>
            <div style={{ fontSize: 18, fontWeight: 900 }}>Daily Spin</div>
            <div style={{ opacity: 0.85, fontSize: 13 }}>
              One spin per day. Claim your bonus runs.
            </div>

            <div style={{ display: "flex", justifyContent: "center" }}>
              <div style={wheelWrap}>
                <div style={outerRing} />
                <div style={outerRing2} />

                <div style={ticksLayer}>
                  {Array.from({ length: 50 }).map((_, i) => {
                    const isMajor = i % 10 === 0;
                    return (
                      <div
                        key={i}
                        style={{
                          ...tick,
                          ...(isMajor ? tickMajor : {}),
                          transform: `translate(-50%, -50%) rotate(${i * (360 / 50)}deg) translateY(-98px)`,
                        }}
                      />
                    );
                  })}
                </div>

                <div
                  style={{
                    ...wheel,
                    transform: `rotate(${wheelDeg}deg)`,
                    transition: spinning
                      ? "transform 2.6s cubic-bezier(.15,.85,.15,1)"
                      : "none",
                  }}
                >
                  <div style={separatorsLayer} />

                  <div style={labelsLayer}>
                    {SEGMENTS.map((v, idx) => {
                      const a = segCenterDeg(idx);
                      return (
                        <div
                          key={v}
                          style={{
                            ...label,
                            transform: `translate(-50%, -50%) rotate(${a}deg) translateY(-58px) rotate(${-a}deg)`,
                          }}
                        >
                          +{v}
                        </div>
                      );
                    })}
                  </div>

                  <div style={hub} />
                </div>

                <div
                  style={{
                    ...wheelNeedle,
                    animation: spinning
                      ? "needleClick 160ms linear infinite"
                      : "none",
                  }}
                />
              </div>
            </div>

            {spinning && (
              <div style={{ fontSize: 13, opacity: 0.85, textAlign: "center" }}>
                Spinning…
              </div>
            )}

            {pendingRuns > 0 ? (
              <div style={{ marginTop: 4, fontSize: 16, textAlign: "center" }}>
                You won <b>+{pendingRuns}</b> runs today!
              </div>
            ) : (
              <div style={{ height: 2 }} />
            )}

            <div style={spinNumber}>
              {pendingRuns > 0 ? `+${pendingRuns}` : "—"}
            </div>

            {pendingRuns === 0 && (
              <div style={{ opacity: 0.75, fontSize: 12, textAlign: "center" }}>
                Spin to reveal
              </div>
            )}

            <div style={{ opacity: 0.8, fontSize: 13 }}>bonus runs</div>

            <div style={modalActions}>
              {pendingRuns === 0 ? (
                <button
                  style={{ ...btn, opacity: spinning ? 0.6 : 1 }}
                  disabled={spinning}
                  onClick={() => {
                    if (spinning) return;

                    if (typeof window !== "undefined" && !canSpinToday()) {
                      setPendingRuns(
                        Math.max(0, Number(getPendingSpin() || 0)),
                      );
                      return;
                    }

                    setSpinning(true);

                    const res = spinOnce();
                    const won = Math.max(
                      1,
                      Math.min(5, Number(res?.runsWon || 1)),
                    ) as SegmentValue;

                    const index = SEGMENTS.indexOf(won);
                    if (index === -1) {
                      setSpinning(false);
                      return;
                    }

                    const centerDeg = segCenterDeg(index);
                    const jitter = (Math.random() - 0.5) * SEG * 0.4;

                    const target = START_DEG + centerDeg + jitter;
                    const delta = START_DEG - target;
                    const extraTurns = 6 * 360;

                    setWheelDeg((prev) => prev + extraTurns + delta);

                    window.setTimeout(() => {
                      setShowSpinConfetti(true);
                      window.setTimeout(() => setShowSpinConfetti(false), 1400);
                      setPendingRuns(won);
                      setSpinning(false);
                    }, 2650);
                  }}
                >
                  🎡 SPIN
                </button>
              ) : (
                <button
                  style={btn}
                  onClick={async () => {
                    const won = Math.max(0, Number(claimSpin() || 0));
                    setPendingRuns(0);
                    setSpinOpen(false);

                    if (won > 0) {
                      const wallet = getWalletId();
                      const g = await grantFreeRuns(wallet, won);
                      if (g.ok) {
                        const dbRuns = await fetchRunsFromDb(wallet);
                        if (dbRuns != null) setRuns(dbRuns);
                      }
                    }

                    setSpinAvailable(Boolean(canSpinToday()));
                  }}
                >
                  ✅ CLAIM
                </button>
              )}

              <button
                style={{ ...btn, opacity: 0.85 }}
                onClick={() => {
                  setSpinOpen(false);
                  setPendingRuns(Math.max(0, Number(getPendingSpin() || 0)));
                }}
              >
                Close
              </button>
            </div>

            {showSpinConfetti && (
              <div style={confettiLayer}>
                {Array.from({ length: 18 }).map((_, i) => (
                  <span
                    key={i}
                    style={{
                      position: "absolute",
                      left: `${(i * 37) % 100}%`,
                      top: "-10px",
                      width: 7,
                      height: 12,
                      borderRadius: 3,
                      background: "rgba(255,255,255,0.9)",
                      transform: `rotate(${(i * 19) % 180}deg)`,
                      animation: `confettiFall 900ms ease-out ${(i % 10) * 35}ms forwards`,
                    }}
                  />
                ))}
              </div>
            )}

            <style jsx global>{`
              @keyframes needleClick {
                0% {
                  transform: translateX(-50%) rotate(0deg);
                }
                50% {
                  transform: translateX(-50%) rotate(-8deg);
                }
                100% {
                  transform: translateX(-50%) rotate(0deg);
                }
              }
              @keyframes confettiFall {
                0% {
                  transform: translateY(0) rotate(0deg);
                  opacity: 1;
                }
                100% {
                  transform: translateY(520px) rotate(220deg);
                  opacity: 0;
                }
              }
            `}</style>
          </div>
        </div>
      )}
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
  overflowX: "hidden",
};

const shell: React.CSSProperties = {
  width: "min(560px, 100%)",
  margin: "0 auto",
};

const header: React.CSSProperties = {
  padding: "10px 2px 14px",
};

const headerTop: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  flexWrap: "wrap",
  alignItems: "flex-start",
};

const brandBlock: React.CSSProperties = {
  minWidth: 0,
  flex: "1 1 220px",
};

const headerRight: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  alignItems: "stretch",
  width: "100%",
};

const headerActions: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  gap: 8,
  width: "100%",
};

const title: React.CSSProperties = {
  fontSize: 28,
  fontWeight: 950,
  letterSpacing: -0.5,
  lineHeight: 1.05,
};

const subtitle: React.CSSProperties = {
  opacity: 0.8,
  marginTop: 4,
  fontSize: 13,
  overflowWrap: "anywhere",
};

const runsBadge: React.CSSProperties = {
  padding: "9px 12px",
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.16)",
  background: "rgba(255,255,255,0.06)",
  fontWeight: 800,
  fontSize: 12,
  width: "fit-content",
  maxWidth: "100%",
};

const headerActionBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 40,
  width: "100%",
  padding: "9px 10px",
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.16)",
  background: "rgba(255,255,255,0.06)",
  color: "white",
  textDecoration: "none",
  fontWeight: 900,
  fontSize: 12,
  minWidth: 0,
};

const buttonTextClamp: React.CSSProperties = {
  display: "block",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  maxWidth: "100%",
};

const card: React.CSSProperties = {
  marginTop: 12,
  padding: 14,
  borderRadius: 18,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(255,255,255,0.04)",
};

const cardHeaderRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "stretch",
  gap: 10,
  marginBottom: 8,
  flexWrap: "wrap",
};

const cardTitle: React.CSSProperties = {
  fontWeight: 950,
  fontSize: 20,
  letterSpacing: -0.2,
  minWidth: 0,
  flex: "1 1 180px",
};

const ctaBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 42,
  padding: "10px 12px",
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.22)",
  background: "rgba(255,255,255,0.10)",
  color: "white",
  textDecoration: "none",
  fontWeight: 950,
  fontSize: 13,
  whiteSpace: "nowrap",
  width: "100%",
  flex: "1 1 180px",
};

const ctaBtnDisabled: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 42,
  padding: "10px 12px",
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(255,255,255,0.05)",
  color: "rgba(255,255,255,0.65)",
  fontWeight: 950,
  fontSize: 13,
  width: "100%",
  flex: "1 1 180px",
};

const line: React.CSSProperties = {
  opacity: 0.92,
  fontSize: 16,
  lineHeight: 1.35,
  overflowWrap: "anywhere",
};

const subline: React.CSSProperties = {
  opacity: 0.78,
  fontSize: 13,
  marginTop: 6,
  lineHeight: 1.35,
  overflowWrap: "anywhere",
};

const pillRow: React.CSSProperties = {
  display: "flex",
  gap: 8,
  flexWrap: "wrap",
  marginTop: 12,
};

const pill: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(255,255,255,0.06)",
  fontSize: 13,
  fontWeight: 800,
  maxWidth: "100%",
  overflowWrap: "anywhere",
};

const pillMuted: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(255,255,255,0.04)",
  fontSize: 13,
  opacity: 0.85,
  fontWeight: 800,
  maxWidth: "100%",
  overflowWrap: "anywhere",
};

const miniPill: React.CSSProperties = {
  padding: "7px 10px",
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(255,255,255,0.05)",
  fontSize: 12,
  fontWeight: 850,
  opacity: 0.95,
  maxWidth: "100%",
};

const miniPillMuted: React.CSSProperties = {
  ...miniPill,
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(255,255,255,0.035)",
  opacity: 0.88,
};

const hintBlue: React.CSSProperties = {
  marginTop: 10,
  fontSize: 13,
  fontWeight: 900,
  color: "#38bdf8",
};

const compactLine: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(255,255,255,0.04)",
  fontSize: 13,
  opacity: 0.92,
  display: "flex",
  justifyContent: "space-between",
  gap: 10,
  flexWrap: "wrap",
  alignItems: "center",
};

const compactLabel: React.CSSProperties = {
  fontWeight: 900,
  whiteSpace: "nowrap",
};

const compactNums: React.CSSProperties = {
  fontVariantNumeric: "tabular-nums",
  fontWeight: 900,
  overflowWrap: "anywhere",
};

const compactSep: React.CSSProperties = {
  opacity: 0.5,
  padding: "0 6px",
  fontWeight: 700,
};

const navGrid: React.CSSProperties = {
  marginTop: 14,
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 10,
};

const navBtn: React.CSSProperties = {
  display: "block",
  textAlign: "center",
  padding: "12px 12px",
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.18)",
  background: "rgba(255,255,255,0.06)",
  color: "white",
  textDecoration: "none",
  fontWeight: 900,
  minWidth: 0,
};

const spinOverlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "rgba(0,0,0,0.75)",
  zIndex: 99999,
  padding: 16,
};

const spinNumber: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "10px 14px",
  minHeight: 48,
  borderRadius: 16,
  border: "1px solid rgba(255,255,255,0.18)",
  background: "rgba(255,255,255,0.06)",
  fontSize: 28,
  fontWeight: 900,
  lineHeight: "1",
  letterSpacing: "0.5px",
  fontVariantNumeric: "tabular-nums",
  WebkitFontSmoothing: "antialiased",
};

const spinModal: React.CSSProperties = {
  width: "min(340px, calc(100vw - 32px))",
  maxWidth: "100%",
  padding: 16,
  borderRadius: 16,
  background: "#0b1220",
  border: "1px solid rgba(255,255,255,0.15)",
  color: "white",
  fontFamily: "system-ui",
  display: "flex",
  flexDirection: "column",
  gap: 10,
  position: "relative",
};

const modalActions: React.CSSProperties = {
  display: "flex",
  gap: 10,
  flexWrap: "wrap",
};

const btn: React.CSSProperties = {
  flex: "1 1 120px",
  minHeight: 42,
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.2)",
  background: "rgba(255,255,255,0.14)",
  color: "white",
  cursor: "pointer",
  fontWeight: 900,
};

const wheelWrap: React.CSSProperties = {
  position: "relative",
  width: 220,
  height: 220,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  maxWidth: "100%",
};

const outerRing: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  borderRadius: "50%",
  border: "2px solid rgba(255,255,255,0.16)",
  boxShadow:
    "0 0 0 6px rgba(255,255,255,0.04), 0 0 24px rgba(255,255,255,0.08)",
  pointerEvents: "none",
};

const outerRing2: React.CSSProperties = {
  position: "absolute",
  inset: 10,
  borderRadius: "50%",
  border: "1px solid rgba(255,255,255,0.10)",
  boxShadow: "inset 0 0 0 10px rgba(0,0,0,0.18)",
  pointerEvents: "none",
};

const wheel: React.CSSProperties = {
  position: "relative",
  width: 190,
  height: 190,
  borderRadius: "50%",
  overflow: "hidden",
  border: "2px solid rgba(255,255,255,0.20)",
  background:
    "repeating-conic-gradient(from -90deg, rgba(255,255,255,0.10) 0 36deg, rgba(255,255,255,0.03) 36deg 72deg)",
  boxShadow: "0 14px 40px rgba(0,0,0,0.45)",
};

const separatorsLayer: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  background:
    "repeating-conic-gradient(from -90deg, rgba(255,255,255,0.18) 0 1deg, transparent 1deg 72deg)",
  opacity: 0.55,
  pointerEvents: "none",
};

const labelsLayer: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  pointerEvents: "none",
};

const label: React.CSSProperties = {
  position: "absolute",
  left: "50%",
  top: "50%",
  fontWeight: 900,
  fontSize: 22,
  lineHeight: "1",
  textShadow: "0 3px 10px rgba(0,0,0,0.55)",
  fontVariantNumeric: "tabular-nums",
  opacity: 0.98,
};

const hub: React.CSSProperties = {
  position: "absolute",
  left: "50%",
  top: "50%",
  transform: "translate(-50%, -50%)",
  width: 14,
  height: 14,
  borderRadius: "50%",
  background: "rgba(255,255,255,0.10)",
  border: "1px solid rgba(255,255,255,0.18)",
  boxShadow: "0 0 0 10px rgba(0,0,0,0.18)",
  pointerEvents: "none",
};

const ticksLayer: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  pointerEvents: "none",
};

const tick: React.CSSProperties = {
  position: "absolute",
  left: "50%",
  top: "50%",
  width: 2,
  height: 10,
  borderRadius: 999,
  background: "rgba(255,255,255,0.22)",
  boxShadow: "0 2px 6px rgba(0,0,0,0.35)",
};

const tickMajor: React.CSSProperties = {
  height: 16,
  background: "rgba(255,255,255,0.38)",
};

const wheelNeedle: React.CSSProperties = {
  position: "absolute",
  top: 6,
  left: "50%",
  transform: "translateX(-50%)",
  width: 0,
  height: 0,
  borderLeft: "12px solid transparent",
  borderRight: "12px solid transparent",
  borderBottom: "20px solid rgba(255,255,255,0.95)",
  filter:
    "drop-shadow(0 0 10px rgba(255,255,255,0.65)) drop-shadow(0 8px 18px rgba(0,0,0,0.55))",
};

const confettiLayer: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  pointerEvents: "none",
  overflow: "hidden",
  zIndex: 20,
};
