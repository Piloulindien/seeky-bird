import { NextRequest, NextResponse } from "next/server";
import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { ECONOMY } from "@/lib/economy";
import type { Mode } from "@/server/runsStore";
import { createRunPaymentIntent } from "@/server/runsStore";
import { treasuryPubkey } from "@/server/solana";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
  "Surrogate-Control": "no-store",
};

type BuyIntentBody = { wallet?: string; mode?: Mode };

function bad(msg: string, status = 400) {
  return NextResponse.json(
    { ok: false, error: msg },
    { status, headers: NO_STORE_HEADERS },
  );
}

function memoIx(memo: string): TransactionInstruction {
  return new TransactionInstruction({
    keys: [],
    programId: new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"),
    data: Buffer.from(memo, "utf8"),
  });
}

function modeToLamports(mode: Mode): number {
  const sol =
    mode === "normal"
      ? ECONOMY.entrySol
      : mode === "daily"
        ? ECONOMY.entrySol
        : 0.01;

  return Math.max(1, Math.floor(sol * 1_000_000_000));
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as BuyIntentBody | null;

  const walletStr = String(body?.wallet || "").trim();
  const mode = body?.mode;

  if (!walletStr || walletStr.length < 8) {
    return bad("INVALID_WALLET");
  }

  if (mode !== "normal" && mode !== "daily" && mode !== "superprize") {
    return bad("INVALID_MODE");
  }

  const rpc = String(process.env.SOLANA_RPC_URL || "").trim();
  if (!rpc) {
    return bad("MISSING_RPC_URL", 500);
  }

  let buyer: PublicKey;
  let treasury: PublicKey;

  try {
    buyer = new PublicKey(walletStr);
    treasury = treasuryPubkey();
  } catch {
    return bad("BAD_PUBKEY");
  }

  const lamports = modeToLamports(mode);

  const intent = createRunPaymentIntent({
    wallet: walletStr,
    mode,
    lamports,
  });

  if (!intent.ok) {
    return bad(intent.error, 500);
  }

  const reference = intent.reference;
  const memo = `seeky:buy:${mode}:${reference}`;

  const connection = new Connection(rpc, "confirmed");
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");

  const instructions = [
    SystemProgram.transfer({
      fromPubkey: buyer,
      toPubkey: treasury,
      lamports,
    }),
    memoIx(memo),
  ];

  const messageV0 = new TransactionMessage({
    payerKey: buyer,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message();

  const tx = new VersionedTransaction(messageV0);

  const txB64 = Buffer.from(tx.serialize()).toString("base64");

  return NextResponse.json(
    {
      ok: true,
      mode,
      to: treasury.toBase58(),
      expectedLamports: lamports,
      reference,
      memo,
      blockhash,
      lastValidBlockHeight,
      txB64,
    },
    { headers: NO_STORE_HEADERS },
  );
}
