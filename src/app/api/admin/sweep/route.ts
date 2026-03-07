// src/app/api/admin/sweep/route.ts
import { NextRequest, NextResponse } from "next/server";
import { LAMPORTS_PER_SOL, SystemProgram, Transaction } from "@solana/web3.js";
import {
  solanaConnection,
  treasuryKeypair,
  treasuryPubkey,
  profitPubkey,
} from "@/server/solana";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
  "Surrogate-Control": "no-store",
};

function assertAdmin(req: NextRequest) {
  const token = String(req.headers.get("x-admin-token") || "").trim();
  const expected = String(
    process.env.ADMIN_TOKEN || process.env.SUPERPRIZE_ADMIN_TOKEN || "",
  ).trim();

  if (!expected || token !== expected) {
    throw new Error("UNAUTHORIZED");
  }
}

export async function POST(req: NextRequest) {
  try {
    assertAdmin(req);
  } catch {
    return NextResponse.json(
      { ok: false, error: "UNAUTHORIZED" },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  const stepSol = Math.max(0.1, Number(process.env.SWEEP_STEP_SOL || "1"));
  const feeBufferSol = Math.max(
    0,
    Number(process.env.SWEEP_FEE_BUFFER_SOL || "0.15"),
  );

  try {
    const conn = solanaConnection();
    const treasury = treasuryKeypair();
    const treasuryPk = treasuryPubkey();
    const profit = profitPubkey();

    const balLamports = await conn.getBalance(treasuryPk, "confirmed");
    const balanceSol = balLamports / LAMPORTS_PER_SOL;

    /**
     * Hackathon-safe conservative reserve:
     * - keeps some SOL for fees / operations
     * - later you should replace this with:
     *   reserved = pending normal payouts + pending daily payouts + pending superprize payouts + fee buffer
     */
    const reservedSol = feeBufferSol;

    const availableSol = Math.max(0, balanceSol - reservedSol);
    const k = Math.floor(availableSol / stepSol);

    if (k <= 0) {
      return NextResponse.json(
        {
          ok: true,
          sweptSol: 0,
          balanceSol,
          reservedSol,
          availableSol,
          treasury: treasuryPk.toBase58(),
          profit: profit.toBase58(),
        },
        { headers: NO_STORE_HEADERS },
      );
    }

    const sweepSol = k * stepSol;
    const lamports = Math.floor(sweepSol * LAMPORTS_PER_SOL);

    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: treasury.publicKey,
        toPubkey: profit,
        lamports,
      }),
    );

    const sig = await conn.sendTransaction(tx, [treasury], {
      skipPreflight: false,
    });

    await conn.confirmTransaction(sig, "confirmed");

    return NextResponse.json(
      {
        ok: true,
        sweptSol: sweepSol,
        signature: sig,
        balanceSol,
        reservedSol,
        availableSol,
        treasury: treasuryPk.toBase58(),
        profit: profit.toBase58(),
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "SWEEP_FAILED";
    return NextResponse.json(
      { ok: false, error: msg },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
