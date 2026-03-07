// src/server/solana.ts
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";

function requiredEnv(name: string): string {
  const v = String(process.env[name] || "").trim();
  if (!v) {
    throw new Error(`Missing ${name}`);
  }
  return v;
}

function optionalPubkeyEnv(name: string): PublicKey | null {
  const v = String(process.env[name] || "").trim();
  if (!v) return null;
  return new PublicKey(v);
}

function keypairFromB58Env(name: string): Keypair {
  const b58 = requiredEnv(name);
  const secret = bs58.decode(b58);
  return Keypair.fromSecretKey(secret);
}

export function solanaConnection() {
  const url = String(
    process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com",
  ).trim();

  return new Connection(url, "confirmed");
}

/* =========================
   TREASURY
========================= */

export function treasuryKeypair(): Keypair {
  return keypairFromB58Env("TREASURY_SECRET_KEY_B58");
}

export function treasuryPubkey(): PublicKey {
  const explicit = optionalPubkeyEnv("TREASURY_PUBKEY");
  if (explicit) return explicit;

  return treasuryKeypair().publicKey;
}

/* =========================
   PAYOUT
========================= */

export function payoutKeypair(): Keypair {
  return keypairFromB58Env("PAYOUT_SECRET_KEY_B58");
}

export function payoutPubkey(): PublicKey {
  const explicit = optionalPubkeyEnv("PAYOUT_PUBKEY");
  if (explicit) return explicit;

  return payoutKeypair().publicKey;
}

/* =========================
   PROFIT
========================= */

export function profitPubkey(): PublicKey {
  return new PublicKey(requiredEnv("PROFIT_WALLET_PUBKEY"));
}
