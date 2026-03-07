import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";

import { consumeSubmitReceipt } from "@/server/runsStore";
import { enterScore } from "@/server/superprize";
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

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    wallet?: string;
    name?: string;
    score?: number;
    startedAt?: number; // ignored: server uses receipt.createdAt
    receipt?: string;
    seed?: number;
    taps?: number[];
  } | null;

  const wallet = assertWallet(String(body?.wallet || "").trim());
  if (!wallet) return bad("INVALID_WALLET");

  const receipt = String(body?.receipt || "").trim();
  const name = String(body?.name || "").trim();

  const scoreClient = Math.max(0, Math.floor(Number(body?.score || 0)));
  const seedClient = Math.floor(Number(body?.seed || 0)) >>> 0;
  const tapsClient = Array.isArray(body?.taps)
    ? body.taps
        .map((n) => Math.max(0, Math.floor(Number(n))))
        .filter((n) => Number.isFinite(n))
    : [];

  if (!receipt) return bad("MISSING_RECEIPT");

  const c = consumeSubmitReceipt({ id: receipt, wallet, mode: "superprize" });
  if (!c.ok) return bad(c.error);

  const startedAtServer = c.createdAt;
  const seedServer = Math.floor(Number(c.seed || 0)) >>> 0;

  if (!seedServer) return bad("MISSING_SERVER_SEED");
  if (!seedClient || tapsClient.length === 0) return bad("MISSING_REPLAY");
  if (seedClient !== seedServer) return bad("SEED_MISMATCH");

  const sim = simulateSeekyRun({ seed: seedServer, tapsMs: tapsClient });
  if (!sim.ok) return bad(sim.error);

  const scoreServer = sim.score;
  if (scoreServer !== scoreClient) {
    return NextResponse.json(
      { ok: false, error: "SCORE_MISMATCH", expected: scoreServer },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const res = enterScore({
    wallet,
    name,
    score: scoreServer,
    startedAt: startedAtServer,
  });

  if (!res.ok) {
    return NextResponse.json(
      { ok: false, error: res.error },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  return NextResponse.json({ ok: true }, { headers: NO_STORE_HEADERS });
}
