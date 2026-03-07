import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import crypto from "crypto";
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

function makeNonce(): string {
  return crypto.randomBytes(16).toString("hex");
}

function assertWallet(wallet: string): string | null {
  const w = String(wallet || "").trim();
  if (!w) return null;
  if (w.startsWith("local_") || w === "training") return null;

  try {
    new PublicKey(w);
    return w;
  } catch {
    return null;
  }
}

function assertPurpose(p: string): "consume" | "submit" | null {
  const x = String(p || "").trim();
  if (x === "consume") return "consume";
  if (x === "submit") return "submit";
  return null;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const wallet = assertWallet(url.searchParams.get("wallet") || "");
  const purpose = assertPurpose(url.searchParams.get("purpose") || "consume");

  if (!wallet) return bad("INVALID_WALLET");
  if (!purpose) return bad("INVALID_PURPOSE");

  const t = nowMs();

  db.prepare(`DELETE FROM auth_nonces WHERE expiresAt <= ?`).run(t);

  db.prepare(
    `
    DELETE FROM auth_nonces
    WHERE wallet = ? AND purpose = ? AND usedAt IS NULL AND expiresAt > ?
      AND rowid NOT IN (
        SELECT rowid FROM auth_nonces
        WHERE wallet = ? AND purpose = ? AND usedAt IS NULL AND expiresAt > ?
        ORDER BY createdAt DESC
        LIMIT 3
      )
  `,
  ).run(wallet, purpose, t, wallet, purpose, t);

  const nonce = makeNonce();
  const createdAt = t;
  const expiresAt = t + 5 * 60 * 1000;

  db.prepare(
    `INSERT INTO auth_nonces(wallet, nonce, purpose, createdAt, expiresAt)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(wallet, nonce, purpose, createdAt, expiresAt);

  const message = `seeky:${purpose}:${wallet}:${nonce}`;

  return NextResponse.json(
    { ok: true, wallet, purpose, nonce, message, expiresAt },
    { headers: NO_STORE_HEADERS },
  );
}
