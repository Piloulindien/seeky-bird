import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";
import bs58 from "bs58";

import {
  consumeRunWithOptionalReceipt,
  getRunsForWallet,
  ensureDailyGuaranteedRun,
  logPaidConsume,
  type Mode,
} from "@/server/runsStore";
import { recordNormalEntry } from "@/server/normalCore";
import { recordDailyEntry } from "@/server/daily";
import { db, nowMs } from "@/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
  "Surrogate-Control": "no-store",
};

type ConsumeBody = {
  wallet?: string;
  mode?: Mode;
  nonce?: string;
  signature?: string;
};

function bad(msg: string, status = 400) {
  return NextResponse.json(
    { ok: false, error: msg },
    { status, headers: NO_STORE_HEADERS },
  );
}

db.prepare(
  `
  CREATE TABLE IF NOT EXISTS auth_nonces (
    wallet TEXT NOT NULL,
    nonce TEXT NOT NULL,
    purpose TEXT NOT NULL,
    createdAt INTEGER NOT NULL,
    expiresAt INTEGER NOT NULL,
    usedAt INTEGER,
    PRIMARY KEY(wallet, nonce, purpose)
  )
`,
).run();

db.prepare(
  `
  CREATE INDEX IF NOT EXISTS auth_nonces_wallet_purpose_expires
  ON auth_nonces(wallet, purpose, expiresAt)
`,
).run();

function assertWalletPk(
  wallet: string,
): { pk: PublicKey; wallet: string } | null {
  const w = String(wallet || "").trim();
  if (!w) return null;

  if (w.startsWith("local_") || w === "training") return null;

  try {
    const pk = new PublicKey(w);
    return { pk, wallet: w };
  } catch {
    return null;
  }
}

function verifySignedNonce(args: {
  walletPk: PublicKey;
  walletStr: string;
  nonce: string;
  signature: string;
  purpose: "consume";
}): { ok: true } | { ok: false; error: string } {
  const nonceStr = String(args.nonce || "").trim();
  const sigB58 = String(args.signature || "").trim();

  if (!nonceStr) return { ok: false, error: "MISSING_NONCE" };
  if (!sigB58) return { ok: false, error: "MISSING_SIGNATURE" };

  const row = db
    .prepare(
      `SELECT wallet, nonce, purpose, expiresAt, usedAt
       FROM auth_nonces
       WHERE wallet = ? AND nonce = ? AND purpose = ?`,
    )
    .get(args.walletStr, nonceStr, args.purpose) as
    | {
        wallet: string;
        nonce: string;
        purpose: string;
        expiresAt: number;
        usedAt?: number | null;
      }
    | undefined;

  if (!row) return { ok: false, error: "NONCE_NOT_FOUND" };

  const t = nowMs();
  if (row.expiresAt <= t) return { ok: false, error: "NONCE_EXPIRED" };
  if (row.usedAt != null) return { ok: false, error: "NONCE_ALREADY_USED" };

  const message = `seeky:${args.purpose}:${args.walletStr}:${nonceStr}`;
  const msgBytes = new TextEncoder().encode(message);

  let sigBytes: Uint8Array;
  try {
    sigBytes = bs58.decode(sigB58);
  } catch {
    return { ok: false, error: "BAD_SIGNATURE_ENCODING" };
  }

  if (sigBytes.length !== 64) {
    return { ok: false, error: "BAD_SIGNATURE_LENGTH" };
  }

  const ok = nacl.sign.detached.verify(
    msgBytes,
    sigBytes,
    args.walletPk.toBytes(),
  );

  if (!ok) return { ok: false, error: "BAD_SIGNATURE" };

  const res = db
    .prepare(
      `UPDATE auth_nonces
       SET usedAt = ?
       WHERE wallet = ? AND nonce = ? AND purpose = ? AND usedAt IS NULL`,
    )
    .run(t, args.walletStr, nonceStr, args.purpose);

  if (res.changes !== 1) return { ok: false, error: "NONCE_RACE" };

  return { ok: true };
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as ConsumeBody | null;

  const walletStrIn = String(body?.wallet || "").trim();
  const mode = body?.mode;

  const w = assertWalletPk(walletStrIn);
  if (!w) return bad("INVALID_WALLET");

  if (mode !== "normal" && mode !== "daily" && mode !== "superprize") {
    return bad("INVALID_MODE");
  }

  try {
    db.prepare(`DELETE FROM auth_nonces WHERE expiresAt <= ?`).run(nowMs());
  } catch {
    // ignore cleanup failure
  }

  const verified = verifySignedNonce({
    walletPk: w.pk,
    walletStr: w.wallet,
    nonce: String(body?.nonce || "").trim(),
    signature: String(body?.signature || "").trim(),
    purpose: "consume",
  });

  if (!verified.ok) return bad(verified.error);

  ensureDailyGuaranteedRun(w.wallet);

  const result = consumeRunWithOptionalReceipt(w.wallet, mode);

  if (!result) {
    const remaining = getRunsForWallet(w.wallet);

    return NextResponse.json(
      { ok: false, error: "NO_RUNS_LEFT", remaining, canBuy: true },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const { used, receipt, seed } = result;

  if (used === "paid") {
    logPaidConsume(w.wallet, mode);

    if (mode === "normal") recordNormalEntry();
    if (mode === "daily") recordDailyEntry();
  }

  const remaining = getRunsForWallet(w.wallet);

  return NextResponse.json(
    { ok: true, used, remaining, receipt, seed },
    { headers: NO_STORE_HEADERS },
  );
}
