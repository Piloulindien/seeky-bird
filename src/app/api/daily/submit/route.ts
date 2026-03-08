import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";

import { submitDailyScore } from "@/server/daily";
import { consumeSubmitReceipt } from "@/server/runsStore";
import { simulateSeekyRun } from "@/server/replaySim";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
  "Surrogate-Control": "no-store",
};

function bad(msg: string, status = 400) {
  return NextResponse.json(
    { ok: false, error: msg },
    { status, headers: NO_STORE_HEADERS },
  );
}

function assertWallet(walletStr: string): string | null {
  const w = String(walletStr || "").trim();
  if (!w) return null;
  if (w.startsWith("local_") || w === "training") return null;

  try {
    new PublicKey(w);
    return w;
  } catch {
    return null;
  }
}

function utcDayNow(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    wallet?: string;
    name?: string;
    score?: number;
    startedAt?: number;
    day?: string;
    receipt?: string;
    seed?: number;
    taps?: number[];
  } | null;

  const wallet = assertWallet(String(body?.wallet || "").trim());
  if (!wallet) return bad("INVALID_WALLET");

  const receipt = String(body?.receipt || "").trim();
  const scoreClient = Math.max(0, Math.floor(Number(body?.score || 0)));
  const seedClient = Math.floor(Number(body?.seed || 0)) >>> 0;
  const tapsClient = Array.isArray(body?.taps)
    ? body.taps
        .map((n) => Math.max(0, Math.floor(Number(n))))
        .filter((n) => Number.isFinite(n))
    : [];

  const day =
    body?.day && /^\d{4}-\d{2}-\d{2}$/.test(body.day) ? body.day : utcDayNow();

  if (!receipt) return bad("MISSING_RECEIPT");

  const c = consumeSubmitReceipt({ id: receipt, wallet, mode: "daily" });
  if (!c.ok) {
    return bad(c.error, 400);
  }

  const startedAtServer = c.createdAt;
  const seedServer = Math.floor(Number(c.seed || 0)) >>> 0;

  if (!seedServer) return bad("MISSING_SERVER_SEED");
  if (!seedClient || tapsClient.length === 0) {
    return bad("MISSING_REPLAY", 400);
  }
  if (seedClient !== seedServer) {
    return bad("SEED_MISMATCH", 400);
  }

  const sim = simulateSeekyRun({ seed: seedServer, tapsMs: tapsClient });
  if (!sim.ok) return bad(sim.error);

  const scoreServer = sim.score;

  if (scoreServer !== scoreClient) {
    return NextResponse.json(
      { ok: false, error: "SCORE_MISMATCH", expected: scoreServer },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const res = submitDailyScore({
    wallet,
    name: String(body?.name || ""),
    score: scoreServer,
    startedAt: startedAtServer,
    day,
  });

  if (!res.ok) {
    return NextResponse.json(res, { status: 400, headers: NO_STORE_HEADERS });
  }

  return NextResponse.json(
    { ok: true, startedAt: startedAtServer, seed: seedServer },
    { headers: NO_STORE_HEADERS },
  );
}
