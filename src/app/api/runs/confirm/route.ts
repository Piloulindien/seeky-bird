import { NextRequest, NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { ECONOMY } from "@/lib/economy";
import type { Mode } from "@/server/runsStore";
import {
  consumeRunPaymentIntent,
  consumeRunWithOptionalReceipt,
  ensureDailyGuaranteedRun,
  getRunsForWallet,
  logPaidConsume,
} from "@/server/runsStore";
import { creditPaidRunFromSignature } from "@/server/runsPayments";
import { treasuryPubkey } from "@/server/solana";
import { recordNormalEntry } from "@/server/normalCore";
import { recordDailyEntry } from "@/server/daily";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
  "Surrogate-Control": "no-store",
};

type ConfirmBody = {
  wallet?: string;
  mode?: Mode;
  reference?: string;
  signature?: string;
};

function bad(msg: string, status = 400) {
  return NextResponse.json(
    { ok: false, error: msg },
    { status, headers: NO_STORE_HEADERS },
  );
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

function decodeMemoData(data: string): string | null {
  try {
    const bytes = bs58.decode(data);
    return Buffer.from(bytes).toString("utf8");
  } catch {
    return null;
  }
}

function findMemoString(parsed: unknown): string | null {
  const tx = parsed as {
    transaction?: {
      message?: {
        instructions?: Array<{
          program?: string;
          parsed?: unknown;
          data?: string;
        }>;
      };
    };
  };

  const ixs = tx?.transaction?.message?.instructions;
  if (!Array.isArray(ixs)) return null;

  for (const ix of ixs) {
    if (ix?.program !== "spl-memo") continue;

    if (typeof ix.parsed === "string" && ix.parsed.trim()) {
      return ix.parsed.trim();
    }

    if (typeof ix.data === "string" && ix.data.trim()) {
      const decoded = decodeMemoData(ix.data.trim());
      if (decoded) return decoded.trim();
    }
  }

  return null;
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as ConfirmBody | null;

  const walletStr = String(body?.wallet || "").trim();
  const mode = body?.mode;
  const reference = String(body?.reference || "").trim();
  const signature = String(body?.signature || "").trim();

  if (!walletStr || walletStr.length < 8) return bad("INVALID_WALLET");
  if (mode !== "normal" && mode !== "daily" && mode !== "superprize") {
    return bad("INVALID_MODE");
  }
  if (!reference) return bad("MISSING_REFERENCE");
  if (!signature) return bad("MISSING_SIGNATURE");

  const rpc = String(process.env.SOLANA_RPC_URL || "").trim();
  if (!rpc) return bad("MISSING_RPC_URL", 500);

  let buyer: PublicKey;
  let treasury: PublicKey;

  try {
    buyer = new PublicKey(walletStr);
    treasury = treasuryPubkey();
  } catch {
    return bad("BAD_PUBKEY");
  }

  const expectedLamports = modeToLamports(mode);
  const expectedMemo = `seeky:buy:${mode}:${reference}`;

  const connection = new Connection(rpc, "confirmed");

  const parsed = await connection.getParsedTransaction(signature, {
    maxSupportedTransactionVersion: 0,
    commitment: "confirmed",
  });

  if (!parsed) return bad("TX_NOT_FOUND");
  if (parsed.meta?.err) return bad("TX_FAILED");

  const accountKeys = parsed.transaction.message.accountKeys.map((k) =>
    typeof k === "string" ? k : k.pubkey.toBase58(),
  );

  if (!accountKeys.includes(buyer.toBase58())) {
    return bad("WALLET_NOT_IN_TX");
  }

  const ixs = parsed.transaction.message.instructions;
  let okTransfer = false;

  for (const ix of ixs) {
    const p = ix as unknown as {
      program?: string;
      parsed?: { type?: string; info?: Record<string, unknown> };
    };

    if (p.program !== "system") continue;
    if (p.parsed?.type !== "transfer") continue;

    const info = p.parsed.info || {};
    const dest = String(info.destination || "");
    const src = String(info.source || "");
    const lamports = Number(info.lamports || 0);

    if (
      src === buyer.toBase58() &&
      dest === treasury.toBase58() &&
      lamports === expectedLamports
    ) {
      okTransfer = true;
      break;
    }
  }

  if (!okTransfer) return bad("BAD_TRANSFER");

  const memo = findMemoString(parsed);
  if (!memo) return bad("MISSING_MEMO");
  if (memo !== expectedMemo) return bad("BAD_MEMO");

  const intent = consumeRunPaymentIntent({
    reference,
    wallet: walletStr,
    mode,
  });

  if (!intent.ok) return bad(intent.error);

  if (intent.lamports !== expectedLamports) {
    return bad("BAD_REFERENCE_AMOUNT");
  }

  const credited = creditPaidRunFromSignature({
    wallet: walletStr,
    mode,
    signature,
    reference,
  });

  if (!credited.ok) return bad(credited.error);

  /**
   * Signature unique : on consomme immédiatement la run payée
   */

  ensureDailyGuaranteedRun(walletStr);

  const consumed = consumeRunWithOptionalReceipt(walletStr, mode);
  if (!consumed) return bad("AUTO_CONSUME_FAILED", 500);

  if (consumed.used === "paid") {
    logPaidConsume(walletStr, mode);

    if (mode === "normal") recordNormalEntry();
    if (mode === "daily") recordDailyEntry();
  }

  const remaining = getRunsForWallet(walletStr);

  return NextResponse.json(
    {
      ok: true,
      receipt: consumed.receipt,
      seed: consumed.seed,
      remaining,
    },
    { headers: NO_STORE_HEADERS },
  );
}
