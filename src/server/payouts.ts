// src/server/payouts.ts
import {
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { solanaConnection, payoutKeypair } from "@/server/solana";

export type ChainPayout = {
  wallet: string;
  amountSol: number;
};

function cleanWallet(wallet: string): PublicKey {
  const w = String(wallet || "").trim();
  if (!w) throw new Error("BAD_WALLET");
  return new PublicKey(w);
}

function cleanLamports(amountSol: number): number {
  const sol = Number(amountSol || 0);
  if (!Number.isFinite(sol) || sol <= 0) return 0;
  return Math.max(0, Math.floor(sol * LAMPORTS_PER_SOL));
}

/**
 * Version groupée :
 * - 1 seule transaction
 * - plusieurs instructions transfer
 * - retourne un tableau avec une seule signature
 *
 * Remarque :
 * si un payout est invalide (wallet non base58), toute la transaction échoue.
 * C'est exactement ce qu'on veut pour les vrais payouts.
 */
export async function payWinnersOnChain(
  payouts: ChainPayout[],
): Promise<string[]> {
  const conn = solanaConnection();
  const payer = payoutKeypair();

  const cleaned = payouts
    .map((p) => ({
      wallet: String(p.wallet || "").trim(),
      lamports: cleanLamports(p.amountSol),
    }))
    .filter((p) => p.wallet && p.lamports > 0);

  if (!cleaned.length) return [];

  const tx = new Transaction();

  for (const p of cleaned) {
    const to = cleanWallet(p.wallet);

    tx.add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: to,
        lamports: p.lamports,
      }),
    );
  }

  const sig = await sendAndConfirmTransaction(conn, tx, [payer], {
    skipPreflight: false,
    commitment: "confirmed",
  });

  return [sig];
}
