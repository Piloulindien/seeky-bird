import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { getRunsForWallet } from "@/server/runsStore";

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

export async function GET(req: NextRequest) {
  const wallet = assertWallet(req.nextUrl.searchParams.get("wallet") || "");
  if (!wallet) {
    return bad("INVALID_WALLET");
  }

  const state = getRunsForWallet(wallet);

  return NextResponse.json(
    { ok: true, wallet, state },
    { headers: NO_STORE_HEADERS },
  );
}
