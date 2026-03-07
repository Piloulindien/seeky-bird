import { NextRequest, NextResponse } from "next/server";
import {
  solanaConnection,
  treasuryKeypair,
  payoutPubkey,
} from "@/server/solana";
import { LAMPORTS_PER_SOL, SystemProgram, Transaction } from "@solana/web3.js";
import { requireAdmin } from "@/server/admin";

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

export async function POST(req: NextRequest) {
  if (!requireAdmin(req)) {
    return bad("UNAUTHORIZED", 401);
  }

  const conn = solanaConnection();
  const treasury = treasuryKeypair();
  const payout = payoutPubkey();

  // configuration
  const targetSol = Number(process.env.PAYOUT_TARGET_SOL || "3");
  const minSol = Number(process.env.PAYOUT_MIN_SOL || "1");

  if (!Number.isFinite(targetSol) || !Number.isFinite(minSol)) {
    return bad("BAD_ENV_CONFIG", 500);
  }

  try {
    const payoutBalanceLamports = await conn.getBalance(payout, "confirmed");
    const payoutBalanceSol = payoutBalanceLamports / LAMPORTS_PER_SOL;

    if (payoutBalanceSol >= minSol) {
      return NextResponse.json(
        {
          ok: true,
          action: "noop",
          payoutBalanceSol,
        },
        { headers: NO_STORE_HEADERS },
      );
    }

    const refillSol = Math.max(0, targetSol - payoutBalanceSol);
    const lamports = Math.floor(refillSol * LAMPORTS_PER_SOL);

    if (lamports <= 0) {
      return NextResponse.json(
        {
          ok: true,
          action: "noop",
          payoutBalanceSol,
        },
        { headers: NO_STORE_HEADERS },
      );
    }

    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: treasury.publicKey,
        toPubkey: payout,
        lamports,
      }),
    );

    const sig = await conn.sendTransaction(tx, [treasury]);
    await conn.confirmTransaction(sig, "confirmed");

    return NextResponse.json(
      {
        ok: true,
        action: "refilled",
        refillSol,
        signature: sig,
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (err) {
    return bad(err instanceof Error ? err.message : "REFILL_FAILED", 500);
  }
}
