// src/server/runsPayments.ts
import { db, nowMs } from "@/server/db";
import {
  ensureDailyGuaranteedRun,
  grantPaidRun,
  type Mode,
} from "@/server/runsStore";

db.prepare(
  `
CREATE TABLE IF NOT EXISTS runs_payments (
  signature TEXT PRIMARY KEY,
  wallet TEXT NOT NULL,
  mode TEXT NOT NULL,
  reference TEXT NOT NULL,
  at INTEGER NOT NULL
)
`,
).run();

db.prepare(
  `
CREATE UNIQUE INDEX IF NOT EXISTS runs_payments_reference_unique
ON runs_payments(reference)
`,
).run();

db.prepare(
  `
CREATE INDEX IF NOT EXISTS runs_payments_wallet_mode_at
ON runs_payments(wallet, mode, at)
`,
).run();

export function creditPaidRunFromSignature(args: {
  wallet: string;
  mode: Mode;
  signature: string;
  reference: string;
}): { ok: true } | { ok: false; error: string } {
  const wallet = String(args.wallet || "").trim();
  const mode = args.mode;
  const signature = String(args.signature || "").trim();
  const reference = String(args.reference || "").trim();

  if (!wallet || wallet.length < 8) return { ok: false, error: "BAD_WALLET" };

  if (mode !== "normal" && mode !== "daily" && mode !== "superprize") {
    return { ok: false, error: "BAD_MODE" };
  }

  if (!signature) return { ok: false, error: "BAD_SIGNATURE" };
  if (!reference) return { ok: false, error: "BAD_REFERENCE" };

  ensureDailyGuaranteedRun(wallet);

  const tx = db.transaction(() => {
    const existingSig = db
      .prepare(`SELECT signature FROM runs_payments WHERE signature = ?`)
      .get(signature) as { signature: string } | undefined;

    if (existingSig) {
      return { ok: false as const, error: "ALREADY_CONFIRMED" };
    }

    const existingRef = db
      .prepare(`SELECT reference FROM runs_payments WHERE reference = ?`)
      .get(reference) as { reference: string } | undefined;

    if (existingRef) {
      return { ok: false as const, error: "REFERENCE_ALREADY_USED" };
    }

    db.prepare(
      `
      INSERT INTO runs_payments(signature, wallet, mode, reference, at)
      VALUES (?, ?, ?, ?, ?)
    `,
    ).run(signature, wallet, mode, reference, nowMs());

    // 🔑 crédite la run payée
    grantPaidRun(wallet, mode, 1);

    return { ok: true as const };
  });

  return tx();
}
