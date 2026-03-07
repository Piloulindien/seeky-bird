// src/server/superprizeReceipts.ts
import { db, nowMs, uid } from "./db";

const TTL_MS = 10 * 60_000; // 10 minutes

db.prepare(
  `
  CREATE TABLE IF NOT EXISTS superprize_receipts (
    id TEXT PRIMARY KEY,
    wallet TEXT NOT NULL,
    createdAt INTEGER NOT NULL,
    expiresAt INTEGER NOT NULL
  )
`,
).run();

export function issueSuperprizeReceipt(wallet: string): string {
  const w = String(wallet || "").trim();
  if (!w || w.length < 8) return "";

  const t = nowMs();
  const id = `spr_${uid()}`;
  const expiresAt = t + TTL_MS;

  db.prepare(
    `INSERT INTO superprize_receipts(id,wallet,createdAt,expiresAt)
     VALUES(?,?,?,?)`,
  ).run(id, w, t, expiresAt);

  // best-effort cleanup
  try {
    db.prepare(`DELETE FROM superprize_receipts WHERE expiresAt < ?`).run(t);
  } catch {
    // ignore
  }

  return id;
}

export function consumeSuperprizeReceipt(args: {
  id: string;
  wallet: string;
}): { ok: true } | { ok: false; error: string } {
  const id = String(args.id || "").trim();
  const wallet = String(args.wallet || "").trim();
  if (!id) return { ok: false, error: "MISSING_RECEIPT" };
  if (!wallet || wallet.length < 8) return { ok: false, error: "BAD_WALLET" };

  const t = nowMs();

  const tx = db.transaction(() => {
    const row = db
      .prepare(
        `SELECT id, wallet, expiresAt
         FROM superprize_receipts
         WHERE id=?`,
      )
      .get(id) as { id: string; wallet: string; expiresAt: number } | undefined;

    if (!row) return { ok: false as const, error: "BAD_RECEIPT" };
    if (row.wallet !== wallet)
      return { ok: false as const, error: "BAD_RECEIPT" };

    if (t > row.expiresAt) {
      db.prepare(`DELETE FROM superprize_receipts WHERE id=?`).run(id);
      return { ok: false as const, error: "RECEIPT_EXPIRED" };
    }

    db.prepare(`DELETE FROM superprize_receipts WHERE id=?`).run(id);
    return { ok: true as const };
  });

  return tx();
}
