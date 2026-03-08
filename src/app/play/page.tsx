"use client";

import type React from "react";
import { useEffect, useRef, useState } from "react";
import type { GameMode } from "../../game/scene";
import { useRouter } from "next/navigation";

import { ECONOMY } from "../../lib/economy";
import {
  fetchSuperprizeStatus,
  fetchSuperprizeLeaderboardTop3,
  submitSuperprizeScore,
} from "../../lib/superprize";
import {
  getConnectedWalletPubkey,
  ensureWalletConnected,
  type SolanaProvider as BaseSolanaProvider,
} from "../../lib/wallet";

import { Connection, Transaction } from "@solana/web3.js";
import bs58 from "bs58";

const LAST_SEEN_PAYOUT_KEY = "seeky_last_seen_payout_round";

/* =========================
   Types
========================= */

type GameLike = { destroy: (removeCanvas?: boolean) => void };

type CreateGameFn = (
  containerId: string,
  mode: GameMode,
  onGameOver?: (score: number, mode: GameMode) => void,
  hud?: {
    runs: number;
    poolSol: number;
    thresholdSol?: number;
    roundId?: number | null;
    getPoolSol?: () => number;
    getTopList?: () => Array<{ name: string; score: number }>;
    getRankInfo?: (score: number) => { rank: number; inTop10: boolean };
    getTop10CutoffScore?: () => number | null;
  },
  onRunStart?: (mode: GameMode) => void,
  opts?: {
    runSeed?: number;
    onTap?: (tMs: number, mode: GameMode) => void;
  },
) => GameLike;

type TopRow = { name: string; score: number };

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

type NormalHistoryResponse = {
  items: Array<{ at: number; roundId: number }>;
  limit: number;
  offset: number;
};

type NormalLeaderboardApi = {
  ok: boolean;
  roundId: number;
  top: Array<{ wallet: string; name: string; score: number }>;
};

type RunsState = {
  free: number;
  normalPaid: number;
  dailyPaid: number;
  superprizePaid: number;
};

type ConsumeOk = {
  ok: true;
  used: "free" | "paid";
  remaining: RunsState;
  receipt?: string | null;
  seed?: number | null;
};

type ConsumeErr = { ok: false; error: string; remaining?: RunsState };
type ConsumeRes = ConsumeOk | ConsumeErr;

type BuyIntentRes =
  | {
      ok: true;
      mode: "normal" | "daily" | "superprize";
      to: string;
      expectedLamports: number;
      reference: string;
      memo: string;
      blockhash: string;
      lastValidBlockHeight: number;
      txB64: string;
    }
  | { ok: false; error?: string };

type ConfirmRes =
  | { ok: true; receipt: string; seed: number }
  | { ok: false; error?: string };

type ToastState = null | {
  kind: "no-runs" | "error" | "info";
  message: string;
  mode: GameMode;
  canBuy?: boolean;
};

type SignedMessageResult =
  | Uint8Array
  | number[]
  | { signature: Uint8Array | number[] };

type PlaySolanaProvider = BaseSolanaProvider & {
  publicKey?: { toBase58: () => string };
  signTransaction?: (tx: Transaction) => Promise<Transaction>;
  signMessage?: (msg: Uint8Array) => Promise<SignedMessageResult>;
};

type NonceRes =
  | {
      ok: true;
      wallet: string;
      purpose: "consume" | "submit";
      nonce: string;
      message: string;
      expiresAt: number;
    }
  | { ok: false; error: string };

type MobileBridgeBuyResponse = {
  type: "SEEKY_MOBILE_BRIDGE_RESPONSE";
  id: string;
  ok: boolean;
  result?: {
    wallet?: string;
    signature?: string;
    receipt?: string;
    seed?: number;
  };
  error?: string;
};

function isMobileBridgeAvailable(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as {
    __SEEKY_MOBILE__?: boolean;
    ReactNativeWebView?: { postMessage?: (msg: string) => void };
  };

  return !!(
    w.__SEEKY_MOBILE__ &&
    w.ReactNativeWebView &&
    typeof w.ReactNativeWebView.postMessage === "function"
  );
}

function makeBridgeId(): string {
  return `seeky_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

async function buyRunViaMobileBridge(
  mode: "normal" | "daily" | "superprize",
): Promise<
  { ok: true; receipt?: string; seed?: number } | { ok: false; error: string }
> {
  if (typeof window === "undefined") {
    return { ok: false, error: "NO_WINDOW" };
  }

  const w = window as unknown as {
    ReactNativeWebView?: { postMessage?: (msg: string) => void };
  };

  const nativeWebView = w.ReactNativeWebView;
  const postMessageToNative = nativeWebView?.postMessage?.bind(nativeWebView);

  if (!postMessageToNative) {
    return { ok: false, error: "MOBILE_BRIDGE_UNAVAILABLE" };
  }

  const id = makeBridgeId();

  return await new Promise((resolve) => {
    const onMessage = (event: MessageEvent) => {
      let data: unknown = event.data;

      if (typeof data === "string") {
        try {
          data = JSON.parse(data);
        } catch {
          return;
        }
      }

      if (!data || typeof data !== "object") return;

      const msg = data as Partial<MobileBridgeBuyResponse>;
      if (msg.type !== "SEEKY_MOBILE_BRIDGE_RESPONSE") return;
      if (msg.id !== id) return;

      cleanup();

      if (!msg.ok) {
        resolve({ ok: false, error: msg.error || "BUY_FAILED" });
        return;
      }

      resolve({
        ok: true,
        receipt: msg.result?.receipt,
        seed:
          typeof msg.result?.seed === "number"
            ? Math.floor(msg.result.seed)
            : undefined,
      });
    };

    const cleanup = () => {
      window.clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
      document.removeEventListener("message", onMessage as EventListener);
    };

    const timeout = window.setTimeout(() => {
      cleanup();
      resolve({ ok: false, error: "MOBILE_BRIDGE_TIMEOUT" });
    }, 30000);

    window.addEventListener("message", onMessage);
    document.addEventListener("message", onMessage as EventListener);

    postMessageToNative(
      JSON.stringify({
        type: "SEEKY_MOBILE_BRIDGE_REQUEST",
        id,
        method: "buyRun",
        payload: { mode },
      }),
    );
  });
}

/* =========================
   Utils
========================= */

function normalizeSignedMessage(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;

  if (Array.isArray(value)) {
    return new Uint8Array(value);
  }

  if (value && typeof value === "object" && "signature" in value) {
    const maybe = (value as { signature?: unknown }).signature;
    if (maybe instanceof Uint8Array) return maybe;
    if (Array.isArray(maybe)) return new Uint8Array(maybe);
  }

  return null;
}

function utcDayNow(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function base64ToU8(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 255;
  return out;
}

function getRpcUrlClient(): string {
  const v =
    (process.env.NEXT_PUBLIC_SOLANA_RPC_URL as string | undefined) || "";
  return v.trim() || "https://api.devnet.solana.com";
}

function parseModeFromUrl(): GameMode {
  if (typeof window === "undefined") return "normal";
  const sp = new URLSearchParams(window.location.search);
  const m = sp.get("mode");
  return m === "training" ||
    m === "normal" ||
    m === "daily" ||
    m === "superprize"
    ? (m as GameMode)
    : "normal";
}

function isEmbeddedPlay(): boolean {
  if (typeof window === "undefined") return false;

  const w = window as unknown as { __SEEKY_MOBILE__?: boolean };
  const sp = new URLSearchParams(window.location.search);

  return (
    sp.get("embed") === "1" ||
    sp.get("mobile") === "1" ||
    w.__SEEKY_MOBILE__ === true
  );
}

async function fetchConsumeNonce(wallet: string): Promise<NonceRes> {
  const url = `/api/auth/nonce?wallet=${encodeURIComponent(
    wallet,
  )}&purpose=consume`;

  const r = await fetch(url, { cache: "no-store" }).catch(() => null);
  if (!r) return { ok: false, error: "NETWORK" };

  const j = (await r.json().catch(() => null)) as NonceRes | null;
  return j && typeof j === "object" ? j : { ok: false, error: "BAD_RESPONSE" };
}

async function signConsumeNonce(
  wallet: string,
): Promise<
  { ok: true; nonce: string; signature: string } | { ok: false; error: string }
> {
  const provider = (await ensureWalletConnected()) as PlaySolanaProvider | null;
  const connectedWallet = provider?.publicKey?.toBase58?.();

  if (!connectedWallet || connectedWallet !== wallet) {
    return { ok: false, error: "NO_WALLET" };
  }

  if (!provider?.signMessage) {
    return { ok: false, error: "WALLET_NO_SIGN_MESSAGE" };
  }

  const nr = await fetchConsumeNonce(wallet);
  if (!nr.ok) {
    return { ok: false, error: nr.error || "NONCE_FAILED" };
  }

  const msgBytes = new TextEncoder().encode(nr.message);
  const signedRaw = await provider.signMessage(msgBytes).catch(() => null);
  const sigBytes = normalizeSignedMessage(signedRaw);

  if (!sigBytes) {
    return { ok: false, error: "SIGN_FAILED" };
  }

  return {
    ok: true,
    nonce: nr.nonce,
    signature: bs58.encode(sigBytes),
  };
}

async function postConsume(mode: GameMode): Promise<ConsumeRes> {
  const provider = (await ensureWalletConnected()) as PlaySolanaProvider | null;
  const wallet = provider?.publicKey?.toBase58?.();
  if (!wallet) return { ok: false, error: "NO_WALLET" };

  const signed = await signConsumeNonce(wallet);
  if (!signed.ok) return { ok: false, error: signed.error };

  const r = await fetch("/api/play/consume", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      wallet,
      mode,
      nonce: signed.nonce,
      signature: signed.signature,
    }),
    cache: "no-store",
  }).catch(() => null);

  if (!r) return { ok: false, error: "NETWORK" };

  try {
    const data = (await r.json()) as ConsumeRes;
    if (!data || typeof data !== "object") {
      return { ok: false, error: "BAD_RESPONSE" };
    }
    if ("ok" in data && typeof (data as { ok: unknown }).ok === "boolean") {
      return data;
    }
    return { ok: false, error: "BAD_RESPONSE" };
  } catch {
    return { ok: false, error: "BAD_RESPONSE" };
  }
}

async function postBuyIntent(
  wallet: string,
  mode: GameMode,
): Promise<BuyIntentRes> {
  const r = await fetch("/api/runs/buy-intent", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ wallet, mode }),
    cache: "no-store",
  }).catch(() => null);

  if (!r) return { ok: false, error: "NETWORK" };
  const j = (await r.json().catch(() => null)) as BuyIntentRes | null;
  return j && typeof j === "object" ? j : { ok: false, error: "BAD_RESPONSE" };
}

async function postConfirm(args: {
  wallet: string;
  mode: GameMode;
  reference: string;
  signature: string;
}): Promise<ConfirmRes> {
  const r = await fetch("/api/runs/confirm", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(args),
    cache: "no-store",
  }).catch(() => null);

  if (!r) return { ok: false, error: "NETWORK" };
  const j = (await r.json().catch(() => null)) as ConfirmRes | null;
  return j && typeof j === "object" ? j : { ok: false, error: "BAD_RESPONSE" };
}

async function buyRunReal(
  mode: GameMode,
): Promise<
  { ok: true; receipt?: string; seed?: number } | { ok: false; error: string }
> {
  if (typeof window === "undefined") return { ok: false, error: "NO_WINDOW" };
  if (mode !== "normal" && mode !== "daily" && mode !== "superprize") {
    return { ok: false, error: "BAD_MODE" };
  }

  if (isEmbeddedPlay() && isMobileBridgeAvailable()) {
    return await buyRunViaMobileBridge(mode);
  }

  const provider = (await ensureWalletConnected()) as PlaySolanaProvider | null;
  if (!provider?.publicKey || !provider?.signTransaction) {
    return { ok: false, error: "NO_WALLET_PROVIDER" };
  }

  const wallet = provider.publicKey.toBase58();

  const bi = await postBuyIntent(wallet, mode);
  if (!bi.ok) return { ok: false, error: bi.error || "BUY_INTENT_FAILED" };

  const tx = Transaction.from(base64ToU8(bi.txB64));
  const signed = await provider.signTransaction(tx);

  const conn = new Connection(getRpcUrlClient(), "confirmed");
  const sig = await conn.sendRawTransaction(signed.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
  });

  await conn.confirmTransaction(sig, "confirmed");

  const cf = await postConfirm({
    wallet,
    mode,
    reference: bi.reference,
    signature: sig,
  });

  if (!cf.ok) {
    return { ok: false, error: cf.error || "CONFIRM_FAILED" };
  }

  return {
    ok: true,
    receipt: cf.receipt,
    seed: cf.seed,
  };
}

/* =========================
   Normal / Daily API helpers
========================= */

async function fetchTop10ForRound(roundId: number): Promise<TopRow[]> {
  const rid = Math.floor(Number(roundId || 0));
  if (!rid) return [];

  const r = await fetch(
    `/api/normal/leaderboard?round=${encodeURIComponent(String(rid))}`,
    { cache: "no-store" },
  ).catch(() => null);

  if (!r || !r.ok) return [];
  const j = (await r.json().catch(() => null)) as NormalLeaderboardApi | null;
  if (!j?.ok || !Array.isArray(j.top)) return [];

  return j.top.map((x) => ({
    name: String(x.name || ""),
    score: Number(x.score || 0),
  }));
}

async function submitNormalScore(args: {
  wallet: string;
  name: string;
  score: number;
  startedAt: number;
  roundId: number;
  receipt: string;
  seed?: number;
  taps?: number[];
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const r = await fetch("/api/normal/submit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(args),
    cache: "no-store",
  }).catch(() => null);

  if (!r) return { ok: false, error: "NETWORK" };

  const j = (await r.json().catch(() => null)) as {
    ok?: boolean;
    error?: string;
  } | null;

  if (!r.ok || !j?.ok) {
    return { ok: false, error: j?.error || "SUBMIT_FAILED" };
  }

  return { ok: true };
}

async function fetchNormalStatus(): Promise<NormalStatusResponse | null> {
  const r = await fetch("/api/normal/status", { cache: "no-store" }).catch(
    () => null,
  );
  if (!r || !r.ok) return null;
  return (await r.json().catch(() => null)) as NormalStatusResponse | null;
}

async function fetchDailyStatus(
  day?: string,
): Promise<DailyStatusResponse | null> {
  const q = day ? `?day=${encodeURIComponent(day)}` : "";
  const r = await fetch(`/api/daily/status${q}`, { cache: "no-store" }).catch(
    () => null,
  );
  if (!r || !r.ok) return null;
  return (await r.json().catch(() => null)) as DailyStatusResponse | null;
}

async function submitDailyScore(args: {
  wallet: string;
  name: string;
  score: number;
  startedAt: number;
  day: string;
  receipt: string;
  seed?: number;
  taps?: number[];
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const r = await fetch("/api/daily/submit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(args),
    cache: "no-store",
  }).catch(() => null);

  if (!r) return { ok: false, error: "NETWORK" };

  const j = (await r.json().catch(() => null)) as {
    ok?: boolean;
    error?: string;
  } | null;

  if (!r.ok || !j?.ok) {
    return { ok: false, error: j?.error || "SUBMIT_FAILED" };
  }

  return { ok: true };
}

async function fetchNormalLastDistribution(): Promise<{
  at: number;
  roundId: number;
} | null> {
  const r = await fetch("/api/normal/history?limit=1&offset=0", {
    cache: "no-store",
  }).catch(() => null);

  if (!r || !r.ok) return null;

  const j = (await r.json().catch(() => null)) as NormalHistoryResponse | null;
  const it = Array.isArray(j?.items) ? j.items[0] : null;

  if (!it) return null;

  const at = typeof it.at === "number" ? it.at : 0;
  const roundId = typeof it.roundId === "number" ? it.roundId : 0;

  if (!at || !roundId) return null;

  return { at, roundId };
}

/* =========================
   Component
========================= */

export default function PlayPage() {
  const router = useRouter();
  const embedded = isEmbeddedPlay();

  const normalRunStartedAtRef = useRef<number | null>(null);
  const dailyRunStartedAtRef = useRef<number | null>(null);
  const superRunStartedAtRef = useRef<number | null>(null);

  const [mode, setMode] = useState<GameMode>(() => parseModeFromUrl());
  const modeRef = useRef<GameMode>(mode);
  const [session, setSession] = useState(0);

  const [toast, setToast] = useState<ToastState>(null);
  const [gameOver, setGameOver] = useState<{ score: number } | null>(null);

  const [showRunConfetti, setShowRunConfetti] = useState(false);
  function fireRunConfetti(durationMs = 1400) {
    if (typeof window === "undefined") return;
    setShowRunConfetti(true);
    window.setTimeout(() => setShowRunConfetti(false), durationMs);
  }

  const [needPseudo, setNeedPseudo] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return !(localStorage.getItem("seeky_pseudo") || "").trim();
  });
  const [pseudoInput, setPseudoInput] = useState("");
  const pseudoRef = useRef<string>(
    typeof window === "undefined"
      ? ""
      : (localStorage.getItem("seeky_pseudo") || "").trim(),
  );

  const runRoundIdRef = useRef<number | null>(null);
  const [runRoundId, setRunRoundId] = useState<number | null>(null);
  const normalPoolRef = useRef<number>(0);
  const normalTop10Ref = useRef<TopRow[]>([]);
  const [normalProgress, setNormalProgress] = useState<null | {
    poolSol: number;
    nextPayoutInEntries: number;
    payoutJustTriggered: boolean;
  }>(null);

  const dailyDayRef = useRef<string>(utcDayNow());
  const dailyPoolRef = useRef<number>(0);
  const dailyTop3Ref = useRef<TopRow[]>([]);
  const [dailyPoolUi, setDailyPoolUi] = useState(0);

  const [superPrizeSol, setSuperPrizeSol] = useState(0);
  const superTop3Ref = useRef<TopRow[]>([]);
  const [superTop3Ui, setSuperTop3Ui] = useState<TopRow[]>([]);
  const superPrizeSolRef = useRef(0);

  const [topList, setTopList] = useState<TopRow[]>([]);
  const [roundCutoff, setRoundCutoff] = useState<number | null>(null);

  const consumedKeyRef = useRef("");

  const normalReceiptRef = useRef<string | null>(null);
  const dailyReceiptRef = useRef<string | null>(null);
  const superReceiptRef = useRef<string | null>(null);

  const normalSeedRef = useRef<number>(0);
  const dailySeedRef = useRef<number>(0);
  const superSeedRef = useRef<number>(0);

  const normalTapsRef = useRef<number[]>([]);
  const dailyTapsRef = useRef<number[]>([]);
  const superTapsRef = useRef<number[]>([]);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const onPop = () => setMode(parseModeFromUrl());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    void (async () => {
      const st = await fetchSuperprizeStatus();
      if (st?.event) {
        const pool = st.event.prizePoolSol ?? 0;
        superPrizeSolRef.current = pool;
        setSuperPrizeSol(pool);
      }
      const top = await fetchSuperprizeLeaderboardTop3();
      const mapped = top.map((x) => ({ name: x.name, score: x.score }));
      superTop3Ref.current = mapped;
      setSuperTop3Ui(mapped);
    })();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (needPseudo) return;

    let alive = true;

    const isVisible = () =>
      typeof document === "undefined" || document.visibilityState === "visible";

    const refreshStatus = async () => {
      if (!alive || !isVisible()) return;

      if (mode === "normal") {
        const st = await fetchNormalStatus();
        if (!alive || !st) return;

        normalPoolRef.current = Number(st.round.poolSol || 0);

        const rid = Number(st.round.id || 0);
        if (rid && runRoundIdRef.current !== rid) {
          runRoundIdRef.current = rid;
          setRunRoundId(rid);
        }
        return;
      }

      if (mode === "daily") {
        const day = dailyDayRef.current || utcDayNow();
        const st = await fetchDailyStatus(day);
        if (!alive || !st) return;

        dailyPoolRef.current = Number(st.day.poolSol || 0);
        setDailyPoolUi(dailyPoolRef.current);
        return;
      }

      if (mode === "superprize") {
        const st = await fetchSuperprizeStatus().catch(() => null);
        if (!alive || !st?.event) return;

        const pool = st.event.prizePoolSol ?? 0;
        superPrizeSolRef.current = pool;
        setSuperPrizeSol(pool);
      }
    };

    const refreshLeaderboard = async () => {
      if (!alive || !isVisible()) return;

      if (mode === "normal") {
        const rid = runRoundIdRef.current;
        if (!rid) return;
        const top = await fetchTop10ForRound(rid);
        if (!alive) return;
        normalTop10Ref.current = top;
        return;
      }

      if (mode === "daily") {
        const day = dailyDayRef.current || utcDayNow();
        const st = await fetchDailyStatus(day);
        if (!alive || !st) return;

        dailyTop3Ref.current = (st.top3 || []).slice(0, 3).map((x) => ({
          name: x.name,
          score: x.score,
        }));
        return;
      }

      if (mode === "superprize") {
        const top = await fetchSuperprizeLeaderboardTop3().catch(() => null);
        if (!alive || !top) return;

        const mapped = top.slice(0, 3).map((x) => ({
          name: x.name,
          score: x.score,
        }));

        superTop3Ref.current = mapped;
        setSuperTop3Ui(mapped);
      }
    };

    void (async () => {
      await refreshStatus();
      await refreshLeaderboard();
    })();

    const statusTimer = window.setInterval(refreshStatus, 2500);
    const leaderboardTimer = window.setInterval(refreshLeaderboard, 6500);

    const onVis = () => {
      if (!isVisible()) return;
      void (async () => {
        await refreshStatus();
        await refreshLeaderboard();
      })();
    };

    try {
      document.addEventListener("visibilitychange", onVis);
    } catch {
      // ignore
    }

    return () => {
      alive = false;
      window.clearInterval(statusTimer);
      window.clearInterval(leaderboardTimer);
      try {
        document.removeEventListener("visibilitychange", onVis);
      } catch {
        // ignore
      }
    };
  }, [mode, needPseudo]);

  useEffect(() => {
    if (needPseudo) return;

    const hasPendingNormalTicket =
      !!String(normalReceiptRef.current || "").trim() &&
      !!Math.floor(Number(normalSeedRef.current || 0));

    const hasPendingDailyTicket =
      !!String(dailyReceiptRef.current || "").trim() &&
      !!Math.floor(Number(dailySeedRef.current || 0));

    const hasPendingSuperTicket =
      !!String(superReceiptRef.current || "").trim() &&
      !!Math.floor(Number(superSeedRef.current || 0));

    if (!hasPendingNormalTicket) {
      normalSeedRef.current = 0;
      normalTapsRef.current = [];
      normalReceiptRef.current = null;
    }

    if (!hasPendingDailyTicket) {
      dailySeedRef.current = 0;
      dailyTapsRef.current = [];
      dailyReceiptRef.current = null;
    }

    if (!hasPendingSuperTicket) {
      superSeedRef.current = 0;
      superTapsRef.current = [];
      superReceiptRef.current = null;
    }

    setToast(null);
    setGameOver(null);
    setTopList([]);
    setRoundCutoff(null);
    setNormalProgress(null);

    dailyDayRef.current = utcDayNow();
    normalRunStartedAtRef.current = null;
    dailyRunStartedAtRef.current = null;
    superRunStartedAtRef.current = null;

    let game: GameLike | null = null;
    let cancelled = false;

    void (async () => {
      const mod = (await import("../../game/createGame")) as unknown as {
        createGame?: CreateGameFn;
        default?: CreateGameFn;
      };
      const createGame = mod.createGame ?? mod.default;
      if (typeof createGame !== "function") {
        throw new Error("createGame not found");
      }
      if (cancelled) return;

      const effectiveMode = parseModeFromUrl();
      if (effectiveMode !== mode) {
        setMode(effectiveMode);
        return;
      }

      if (effectiveMode !== "training") {
        const key = `${effectiveMode}:${session}`;
        const alreadyHaveReceipt =
          (effectiveMode === "normal" &&
            !!String(normalReceiptRef.current || "").trim() &&
            !!Math.floor(Number(normalSeedRef.current || 0))) ||
          (effectiveMode === "daily" &&
            !!String(dailyReceiptRef.current || "").trim() &&
            !!Math.floor(Number(dailySeedRef.current || 0))) ||
          (effectiveMode === "superprize" &&
            !!String(superReceiptRef.current || "").trim() &&
            !!Math.floor(Number(superSeedRef.current || 0)));

        if (consumedKeyRef.current !== key) {
          consumedKeyRef.current = key;

          if (!alreadyHaveReceipt) {
            if (effectiveMode === "superprize") {
              const st = await fetchSuperprizeStatus();
              const ev = st?.event;
              if (!ev || ev.status !== "live") {
                setToast({
                  kind: "info",
                  mode: effectiveMode,
                  message: "Superprize is not active right now.",
                  canBuy: false,
                });
                return;
              }

              const pool = ev.prizePoolSol ?? 0;
              superPrizeSolRef.current = pool;
              setSuperPrizeSol(pool);
            }

            const pk = getConnectedWalletPubkey();
            if (!pk) {
              setToast({
                kind: "info",
                mode: effectiveMode,
                canBuy: false,
                message: "Connect wallet to play.",
              });
              return;
            }

            if (isEmbeddedPlay()) {
              setToast({
                kind: "no-runs",
                mode: effectiveMode,
                canBuy: true,
                message:
                  effectiveMode === "daily"
                    ? "No daily runs available."
                    : effectiveMode === "normal"
                      ? "No normal runs available."
                      : effectiveMode === "superprize"
                        ? "No Superprize runs available."
                        : "No runs available.",
              });
              return;
            }

            const cr = await postConsume(effectiveMode);

            if (!cr.ok) {
              if (cr.error === "NO_RUNS_LEFT") {
                setToast({
                  kind: "no-runs",
                  mode: effectiveMode,
                  canBuy: true,
                  message:
                    effectiveMode === "daily"
                      ? "No daily runs available."
                      : effectiveMode === "normal"
                        ? "No normal runs available."
                        : effectiveMode === "superprize"
                          ? "No Superprize runs available."
                          : "No runs available.",
                });
                return;
              }

              if (
                cr.error === "NO_WALLET" ||
                cr.error === "WALLET_NO_SIGN_MESSAGE" ||
                cr.error === "SIGN_FAILED" ||
                cr.error === "NONCE_FAILED"
              ) {
                setToast({
                  kind: "info",
                  mode: effectiveMode,
                  canBuy: false,
                  message: "Wallet signature required to play.",
                });
                return;
              }

              setToast({
                kind: "error",
                mode: effectiveMode,
                canBuy: false,
                message: `Consume failed: ${cr.error}`,
              });
              return;
            }
          }
        }
      }

      if (effectiveMode === "daily") {
        const st = await fetchDailyStatus(dailyDayRef.current);
        if (st) {
          dailyPoolRef.current = Number(st.day.poolSol || 0);
          setDailyPoolUi(dailyPoolRef.current);
          dailyTop3Ref.current = (st.top3 || [])
            .slice(0, 3)
            .map((x) => ({ name: x.name, score: x.score }));
        }
      } else if (effectiveMode === "normal") {
        const st = await fetchNormalStatus();
        if (st) {
          normalPoolRef.current = Number(st.round.poolSol || 0);
          const rid = Number(st.round.id || 0);
          if (rid) {
            runRoundIdRef.current = rid;
            setRunRoundId(rid);
            normalTop10Ref.current = await fetchTop10ForRound(rid);
          }
        }
      } else if (effectiveMode === "superprize") {
        const top = await fetchSuperprizeLeaderboardTop3().catch(() => []);
        const mapped = top
          .slice(0, 3)
          .map((x) => ({ name: x.name, score: x.score }));
        superTop3Ref.current = mapped;
        setSuperTop3Ui(mapped);
      }

      const hud =
        effectiveMode === "daily"
          ? {
              runs: 0,
              poolSol: dailyPoolRef.current,
              getPoolSol: () => dailyPoolRef.current,
              getTopList: () => dailyTop3Ref.current,
              getRankInfo: (score: number) => {
                const scores = dailyTop3Ref.current.map((t) => t.score);
                const better = scores.filter((s) => s > score).length;
                const rank = better + 1;
                return { rank, inTop10: rank <= 3 };
              },
              getTop10CutoffScore: () => {
                const top = dailyTop3Ref.current;
                return top.length >= 3 ? top[2].score : null;
              },
            }
          : effectiveMode === "superprize"
            ? {
                runs: 0,
                poolSol: superPrizeSolRef.current,
                getPoolSol: () => superPrizeSolRef.current,
                getTopList: () => superTop3Ref.current,
                getRankInfo: (score: number) => {
                  const scores = superTop3Ref.current.map((t) => t.score);
                  const better = scores.filter((s) => s > score).length;
                  const rank = better + 1;
                  return { rank, inTop10: rank <= 3 };
                },
                getTop10CutoffScore: () => {
                  const top = superTop3Ref.current;
                  return top.length >= 3 ? top[2].score : null;
                },
              }
            : effectiveMode === "training"
              ? { runs: 0, poolSol: 0 }
              : {
                  runs: 0,
                  poolSol: normalPoolRef.current,
                  roundId: runRoundIdRef.current,
                  thresholdSol: ECONOMY.thresholdSol,
                  getPoolSol: () => normalPoolRef.current,
                  getRankInfo: (score: number) => {
                    const top = normalTop10Ref.current;
                    const scores = top.map((t) => t.score);
                    const better = scores.filter((s) => s > score).length;
                    const rank = better + 1;
                    return { rank, inTop10: rank <= 10 };
                  },
                  getTop10CutoffScore: () => {
                    const top = normalTop10Ref.current;
                    return top.length >= 10 ? top[9].score : null;
                  },
                };

      game = createGame(
        "game-container",
        effectiveMode,
        async (score: number) => {
          if (cancelled) return;

          const finalMode = modeRef.current;

          setGameOver({ score });
          if (finalMode !== "training") fireRunConfetti(1200);

          const name = pseudoRef.current.trim();
          const pk = getConnectedWalletPubkey();

          if (!pk && finalMode !== "training") {
            setToast({
              kind: "error",
              mode: finalMode,
              message: "Submit blocked: wallet not connected.",
            });
            return;
          }

          const walletId = pk || "training";

          if (finalMode === "normal") {
            const rid = runRoundIdRef.current;
            const startedAt = normalRunStartedAtRef.current ?? Date.now();
            const receipt = String(normalReceiptRef.current || "").trim();
            const seed = Math.floor(Number(normalSeedRef.current || 0));
            const taps = [...normalTapsRef.current];

            if (!name) {
              setToast({
                kind: "error",
                mode: "normal",
                message: "Normal submit blocked: missing pseudo.",
              });
              return;
            }

            if (!rid) {
              setToast({
                kind: "error",
                mode: "normal",
                message: "Normal submit blocked: missing round.",
              });
              return;
            }

            if (!receipt) {
              setToast({
                kind: "error",
                mode: "normal",
                message: "Normal submit blocked: missing receipt.",
              });
              return;
            }

            if (!seed) {
              setToast({
                kind: "error",
                mode: "normal",
                message: "Normal submit blocked: missing seed.",
              });
              return;
            }

            if (!taps.length) {
              setToast({
                kind: "error",
                mode: "normal",
                message: "Normal submit blocked: missing taps replay.",
              });
              return;
            }

            const res = await submitNormalScore({
              wallet: walletId,
              name,
              score,
              startedAt,
              roundId: rid,
              receipt,
              seed,
              taps,
            });

            if (!res.ok) {
              setToast({
                kind: "error",
                mode: "normal",
                message: `Normal submit failed: ${res.error}`,
              });
              return;
            }

            normalReceiptRef.current = null;

            const st = await fetchNormalStatus();
            if (st) {
              normalPoolRef.current = Number(st.round.poolSol || 0);
              const remaining = ECONOMY.thresholdSol - normalPoolRef.current;
              const perEntryToPool = ECONOMY.entrySol * ECONOMY.take.rewards;

              const nextPayoutInEntries =
                remaining <= 0 || perEntryToPool <= 0
                  ? 0
                  : Math.ceil(remaining / perEntryToPool);

              let payoutJustTriggered = false;

              const lastDist = await fetchNormalLastDistribution();

              if (lastDist && typeof window !== "undefined") {
                const sameRoundJustSettled = lastDist.roundId === rid;
                const seenKey = `${LAST_SEEN_PAYOUT_KEY}:${rid}`;
                const lastSeenForRound = Number(
                  localStorage.getItem(seenKey) || "0",
                );

                if (sameRoundJustSettled && lastDist.at > lastSeenForRound) {
                  payoutJustTriggered = true;
                  localStorage.setItem(seenKey, String(lastDist.at));
                }
              }

              if (payoutJustTriggered) fireRunConfetti(2200);

              setNormalProgress({
                poolSol: normalPoolRef.current,
                nextPayoutInEntries,
                payoutJustTriggered,
              });

              const nextTop = await fetchTop10ForRound(st.round.id);
              normalTop10Ref.current = nextTop;
              setTopList(nextTop);

              const cutoff = nextTop.length >= 10 ? nextTop[9].score : null;
              setRoundCutoff(cutoff);
            }

            return;
          }

          if (finalMode === "daily") {
            const day = dailyDayRef.current || utcDayNow();
            const startedAt = dailyRunStartedAtRef.current ?? Date.now();
            const receipt = String(dailyReceiptRef.current || "").trim();
            const seed = Math.floor(Number(dailySeedRef.current || 0));
            const taps = [...dailyTapsRef.current];

            if (!name) {
              setToast({
                kind: "error",
                mode: "daily",
                message: "Daily submit blocked: missing pseudo.",
              });
              return;
            }

            if (!receipt) {
              setToast({
                kind: "error",
                mode: "daily",
                message: "Daily submit blocked: missing receipt.",
              });
              return;
            }

            if (!seed) {
              setToast({
                kind: "error",
                mode: "daily",
                message: "Daily submit blocked: missing seed.",
              });
              return;
            }

            if (!taps.length) {
              setToast({
                kind: "error",
                mode: "daily",
                message: "Daily submit blocked: missing taps replay.",
              });
              return;
            }

            const res = await submitDailyScore({
              wallet: walletId,
              name,
              score,
              startedAt,
              day,
              receipt,
              seed,
              taps,
            });

            if (!res.ok) {
              setToast({
                kind: "error",
                mode: "daily",
                message: `Daily submit failed: ${res.error}`,
              });
              return;
            }

            dailyReceiptRef.current = null;
            fireRunConfetti(1500);

            const st = await fetchDailyStatus(day);
            if (st) {
              dailyPoolRef.current = Number(st.day.poolSol || 0);
              setDailyPoolUi(dailyPoolRef.current);

              const nextTop = (st.top3 || [])
                .slice(0, 3)
                .map((x) => ({ name: x.name, score: x.score }));

              dailyTop3Ref.current = nextTop;
              setTopList(nextTop);

              const cutoff = nextTop.length >= 3 ? nextTop[2].score : null;
              setRoundCutoff(cutoff);
            }

            return;
          }

          if (finalMode === "superprize") {
            const startedAt = superRunStartedAtRef.current ?? Date.now();

            const receipt = String(superReceiptRef.current || "").trim();
            superReceiptRef.current = null;

            if (!receipt) {
              setToast({
                kind: "error",
                mode: "superprize",
                message: "Superprize submit blocked (missing receipt).",
              });
              return;
            }

            const res = await submitSuperprizeScore({
              wallet: walletId,
              name,
              score,
              startedAt,
              receipt,
              seed: superSeedRef.current,
              taps: superTapsRef.current,
            });

            if (!res.ok) {
              setToast({
                kind: "error",
                mode: "superprize",
                message: `Superprize submit failed: ${res.error}`,
              });
            }

            const [st, top3] = await Promise.all([
              fetchSuperprizeStatus(),
              fetchSuperprizeLeaderboardTop3(),
            ]);

            if (st?.event) {
              const pool = st.event.prizePoolSol ?? 0;
              superPrizeSolRef.current = pool;
              setSuperPrizeSol(pool);
            }

            const mapped = (top3 || [])
              .slice(0, 3)
              .map((x) => ({ name: x.name, score: x.score }));

            superTop3Ref.current = mapped;
            setSuperTop3Ui(mapped);
            setTopList(mapped);

            const cutoff = mapped.length >= 3 ? mapped[2].score : null;
            setRoundCutoff(cutoff);

            return;
          }
        },
        hud,
        async (m: GameMode) => {
          modeRef.current = m;

          if (m === "normal") {
            normalRunStartedAtRef.current = Date.now();
            const st = await fetchNormalStatus();
            if (st?.round?.id) {
              runRoundIdRef.current = st.round.id;
              setRunRoundId(st.round.id);
              normalTop10Ref.current = await fetchTop10ForRound(st.round.id);
            }
            return;
          }

          if (m === "daily") {
            dailyDayRef.current = utcDayNow();
            dailyRunStartedAtRef.current = Date.now();
            return;
          }

          if (m === "superprize") {
            superRunStartedAtRef.current = Date.now();
          }
        },
        {
          runSeed:
            effectiveMode === "normal"
              ? normalSeedRef.current
              : effectiveMode === "daily"
                ? dailySeedRef.current
                : effectiveMode === "superprize"
                  ? superSeedRef.current
                  : 0,
          onTap: (tMs: number, m: GameMode) => {
            const v = Math.max(0, Math.floor(Number(tMs || 0)));
            if (m === "normal") normalTapsRef.current.push(v);
            if (m === "daily") dailyTapsRef.current.push(v);
            if (m === "superprize") superTapsRef.current.push(v);
          },
        },
      );
    })();

    return () => {
      cancelled = true;
      game?.destroy(true);
    };
  }, [mode, session, needPseudo]);

  return (
    <main style={embedded ? wrapEmbed : wrap}>
      <div id="game-container" style={embedded ? gameBoxEmbed : gameBox} />

      {showRunConfetti && (
        <div style={confettiLayer}>
          {Array.from({ length: 28 }).map((_, i) => (
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
                animation: `confettiFall 900ms ease-out ${
                  (i % 12) * 35
                }ms forwards`,
              }}
            />
          ))}
        </div>
      )}

      {toast && mode !== "training" && (
        <div style={toastOverlay}>
          <div style={toastModal}>
            <div style={modalText}>{toast.message}</div>

            {toast.kind === "info" && !embedded && (
              <button
                style={btnFull}
                onClick={async () => {
                  const p = await ensureWalletConnected();
                  const pk = p?.publicKey?.toBase58?.();
                  if (!pk) {
                    setToast({
                      kind: "error",
                      mode: toast.mode,
                      message: "Wallet connection refused or unavailable.",
                    });
                    return;
                  }
                  setToast(null);
                  setSession((s) => s + 1);
                }}
              >
                Connect wallet
              </button>
            )}

            {toast.kind === "info" && embedded && (
              <button style={btnFull} onClick={() => router.push("/")}>
                Back
              </button>
            )}

            {toast.kind === "no-runs" && toast.canBuy !== false && (
              <button
                style={btnFull}
                onClick={async () => {
                  const res = await buyRunReal(toast.mode);

                  if (!res.ok) {
                    setToast({
                      kind: "error",
                      mode: toast.mode,
                      message:
                        res.error === "NO_WALLET_PROVIDER"
                          ? "No mobile wallet available."
                          : `Buy failed: ${res.error}`,
                    });
                    return;
                  }

                  if (toast.mode === "normal") {
                    const receipt = String(res.receipt || "").trim();
                    const seed = Math.floor(Number(res.seed ?? 0));

                    if (!receipt || !seed) {
                      setToast({
                        kind: "error",
                        mode: toast.mode,
                        message:
                          "Buy succeeded but no playable ticket was returned.",
                      });
                      return;
                    }

                    normalReceiptRef.current = receipt;
                    normalSeedRef.current = seed;
                    normalTapsRef.current = [];
                  }

                  if (toast.mode === "daily") {
                    const receipt = String(res.receipt || "").trim();
                    const seed = Math.floor(Number(res.seed ?? 0));

                    if (!receipt || !seed) {
                      setToast({
                        kind: "error",
                        mode: toast.mode,
                        message:
                          "Buy succeeded but no playable ticket was returned.",
                      });
                      return;
                    }

                    dailyReceiptRef.current = receipt;
                    dailySeedRef.current = seed;
                    dailyTapsRef.current = [];
                  }

                  if (toast.mode === "superprize") {
                    const receipt = String(res.receipt || "").trim();
                    const seed = Math.floor(Number(res.seed ?? 0));

                    if (!receipt || !seed) {
                      setToast({
                        kind: "error",
                        mode: toast.mode,
                        message:
                          "Buy succeeded but no playable ticket was returned.",
                      });
                      return;
                    }

                    superReceiptRef.current = receipt;
                    superSeedRef.current = seed;
                    superTapsRef.current = [];
                  }

                  consumedKeyRef.current = `${toast.mode}:${session + 1}`;
                  setToast(null);
                  setGameOver(null);
                  setSession((s) => s + 1);
                }}
              >
                Buy & Play ({toast.mode})
              </button>
            )}

            <button style={btnFull} onClick={() => router.push("/")}>
              Home
            </button>
          </div>
        </div>
      )}

      {needPseudo && (
        <div style={overlay}>
          <div style={modal}>
            <div style={modalHeading}>
              <b>Choisis ton pseudo</b>
            </div>

            <input
              value={pseudoInput}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setPseudoInput(e.target.value)
              }
              placeholder="ex: PierreLouis"
              style={input}
              autoFocus
            />

            <button
              style={btnFull}
              onClick={() => {
                const p = pseudoInput.trim();
                if (!p) return;
                localStorage.setItem("seeky_pseudo", p);
                pseudoRef.current = p;
                setNeedPseudo(false);
              }}
            >
              OK
            </button>
          </div>
        </div>
      )}

      {gameOver && (
        <div style={overlay}>
          <div style={modal}>
            <div style={gameOverTitle}>Game Over</div>
            <div style={modalText}>
              Score : <b>{gameOver.score}</b>
            </div>

            {mode === "normal" && runRoundId != null && (
              <div style={metaText}>
                This run counted for <b>Round #{runRoundId}</b>
              </div>
            )}

            {mode === "daily" && (
              <div style={metaText}>
                Pool today: <b>{dailyPoolUi.toFixed(3)} SOL</b>
              </div>
            )}

            {mode === "superprize" && (
              <div style={metaText}>
                Superprize: <b>{superPrizeSol.toFixed(3)} SOL</b> · Top 3 only
              </div>
            )}

            {mode === "normal" && normalProgress && (
              <div style={progressCard}>
                {normalProgress.payoutJustTriggered && (
                  <div style={progressSuccess}>✅ Payout triggered</div>
                )}

                <div style={progressRow}>
                  <span style={progressLabel}>Pool</span>
                  <span style={progressValue}>
                    {normalProgress.poolSol.toFixed(3)} /{" "}
                    {ECONOMY.thresholdSol.toFixed(3)} SOL
                  </span>
                </div>

                <div style={progressRow}>
                  <span style={progressLabel}>Next payout in</span>
                  <span style={progressValue}>
                    {normalProgress.nextPayoutInEntries} paid entries
                  </span>
                </div>
              </div>
            )}

            {mode !== "training" && (
              <div style={{ marginTop: 12, width: "100%" }}>
                <div style={sectionHeading}>
                  {mode === "superprize" || mode === "daily"
                    ? "Top 3"
                    : "Top 10"}
                </div>

                {(mode === "normal" || mode === "superprize") && (
                  <div style={cutoffText}>
                    {roundCutoff == null ? (
                      <>
                        Cutoff: <b>open</b>
                      </>
                    ) : (
                      <>
                        Cutoff: <b>{roundCutoff}</b>{" "}
                        {roundCutoff > gameOver.score ? (
                          <>
                            · Need <b>+{roundCutoff - gameOver.score + 1}</b>
                          </>
                        ) : (
                          <>
                            · <b>Reached ✅</b>
                          </>
                        )}
                      </>
                    )}
                  </div>
                )}

                <div style={scoreList}>
                  {topList.map((p, i) => (
                    <div key={`${p.name}-${p.score}-${i}`} style={scoreRow}>
                      <span style={scoreName}>
                        #{i + 1} {p.name}
                      </span>
                      <span style={scoreValue}>{p.score}</span>
                    </div>
                  ))}
                </div>

                {mode === "superprize" && superTop3Ui.length === 0 && (
                  <div style={emptyText}>No scores yet.</div>
                )}
              </div>
            )}

            <div style={actionsWrap}>
              <button
                style={btn}
                onClick={() => {
                  setGameOver(null);
                  setSession((s) => s + 1);
                }}
              >
                Replay
              </button>

              <button style={btn} onClick={() => router.push("/")}>
                Home
              </button>

              {mode !== "training" && mode !== "superprize" && (
                <button
                  style={btn}
                  onClick={() =>
                    router.push(
                      mode === "daily"
                        ? "/leaderboard?tab=daily"
                        : "/leaderboard?tab=normal",
                    )
                  }
                >
                  {mode === "daily" ? "Daily Leaderboard" : "Leaderboard"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <style jsx global>{`
        @keyframes confettiFall {
          0% {
            transform: translateY(0) rotate(0deg);
            opacity: 1;
          }
          100% {
            transform: translateY(720px) rotate(220deg);
            opacity: 0;
          }
        }
      `}</style>
    </main>
  );
}

/* =========================
   Styles
========================= */

const wrap: React.CSSProperties = {
  minHeight: "100dvh",
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  background: "#020617",
  padding: 12,
  overflow: "hidden",
};

const gameBox: React.CSSProperties = {
  width: "min(390px, calc(100vw - 24px))",
  maxWidth: "100%",
  height: "min(720px, calc(100dvh - 24px))",
  maxHeight: "100dvh",
  borderRadius: 16,
  overflow: "hidden",
  boxShadow: "0 10px 30px rgba(0,0,0,0.4)",
  background: "#000",
};

const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  background: "rgba(0,0,0,0.6)",
  padding: 12,
  zIndex: 99999,
};

const modal: React.CSSProperties = {
  width: "min(380px, 100%)",
  maxHeight: "min(88dvh, 760px)",
  overflowY: "auto",
  padding: 16,
  borderRadius: 14,
  background: "#0b1220",
  border: "1px solid rgba(255,255,255,0.15)",
  color: "white",
  fontFamily: "system-ui",
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

const input: React.CSSProperties = {
  padding: "12px 12px",
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.2)",
  background: "rgba(255,255,255,0.06)",
  color: "white",
  outline: "none",
  minHeight: 44,
};

const btn: React.CSSProperties = {
  padding: "12px 12px",
  minHeight: 44,
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.2)",
  background: "rgba(255,255,255,0.14)",
  color: "white",
  cursor: "pointer",
  flex: "1 1 120px",
};

const btnFull: React.CSSProperties = {
  padding: "12px 12px",
  minHeight: 44,
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.2)",
  background: "rgba(255,255,255,0.14)",
  color: "white",
  cursor: "pointer",
  width: "100%",
};

const toastOverlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  background: "rgba(0,0,0,0.55)",
  padding: 12,
  zIndex: 99999,
};

const toastModal: React.CSSProperties = {
  width: "min(380px, 100%)",
  padding: 16,
  borderRadius: 14,
  background: "#0b1220",
  border: "1px solid rgba(255,255,255,0.15)",
  color: "white",
  fontFamily: "system-ui",
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

const modalHeading: React.CSSProperties = {
  fontSize: 18,
  lineHeight: 1.2,
};

const gameOverTitle: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 700,
  lineHeight: 1.1,
};

const modalText: React.CSSProperties = {
  opacity: 0.9,
  lineHeight: 1.4,
  overflowWrap: "anywhere",
};

const metaText: React.CSSProperties = {
  fontSize: 13,
  opacity: 0.8,
  lineHeight: 1.4,
  overflowWrap: "anywhere",
};

const progressCard: React.CSSProperties = {
  width: "100%",
  marginTop: 6,
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(255,255,255,0.04)",
  fontSize: 13,
  opacity: 0.92,
};

const progressSuccess: React.CSSProperties = {
  marginBottom: 8,
  fontWeight: 900,
};

const progressRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 10,
  marginTop: 6,
};

const progressLabel: React.CSSProperties = {
  opacity: 0.85,
};

const progressValue: React.CSSProperties = {
  fontWeight: 800,
  textAlign: "right",
};

const sectionHeading: React.CSSProperties = {
  fontWeight: 700,
  marginBottom: 8,
};

const cutoffText: React.CSSProperties = {
  fontSize: 13,
  opacity: 0.8,
  marginBottom: 6,
  lineHeight: 1.4,
  overflowWrap: "anywhere",
};

const scoreList: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const scoreRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 10,
  opacity: 0.92,
  padding: "8px 10px",
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.15)",
  background: "rgba(255,255,255,0.03)",
};

const scoreName: React.CSSProperties = {
  minWidth: 0,
  overflowWrap: "anywhere",
};

const scoreValue: React.CSSProperties = {
  flexShrink: 0,
  textAlign: "right",
};

const emptyText: React.CSSProperties = {
  fontSize: 13,
  opacity: 0.7,
  marginTop: 8,
};

const actionsWrap: React.CSSProperties = {
  display: "flex",
  gap: 8,
  marginTop: 14,
  width: "100%",
  flexWrap: "wrap",
};

const confettiLayer: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  pointerEvents: "none",
  overflow: "hidden",
  zIndex: 99998,
};

const wrapEmbed: React.CSSProperties = {
  minHeight: "100dvh",
  width: "100vw",
  height: "100dvh",
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  background: "#020617",
  padding: 0,
  margin: 0,
  overflow: "hidden",
};

const gameBoxEmbed: React.CSSProperties = {
  width: "100vw",
  height: "100dvh",
  maxWidth: "100vw",
  maxHeight: "100dvh",
  borderRadius: 0,
  overflow: "hidden",
  boxShadow: "none",
  background: "#000",
};
