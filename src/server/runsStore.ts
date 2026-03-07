// src/server/runsStore.ts
import { db, nowMs, uid } from "./db";
import crypto from "node:crypto";

export type Mode = "normal" | "daily" | "superprize";

export type RunsState = {
  free: number;
  normalPaid: number;
  dailyPaid: number;
  superprizePaid: number;
};

/** =========================
 *  Daily free runs (DB source of truth)
 *  - free runs expire at 00:00 UTC
 *  - 1 guaranteed free run/day (UTC)
 *  - max 6 free runs/day (UTC) including spin wins
 * ========================= */

function utcDayNow(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Create daily table once (safe to run multiple times)
db.prepare(
  `
  CREATE TABLE IF NOT EXISTS runs_daily (
    wallet TEXT PRIMARY KEY,
    day TEXT NOT NULL,
    guaranteed INTEGER NOT NULL DEFAULT 0,
    updatedAt INTEGER NOT NULL
  )
`,
).run();

// === Paid-run audit log (NOT security) ====================
// Pure logging/analytics. Not consulted by any submit endpoint.
db.prepare(
  `
  CREATE TABLE IF NOT EXISTS runs_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wallet TEXT NOT NULL,
    mode TEXT NOT NULL,
    at INTEGER NOT NULL
  );
`,
).run();

db.prepare(
  `CREATE INDEX IF NOT EXISTS runs_audit_wallet_mode_at
   ON runs_audit(wallet, mode, at);`,
).run();

export function logPaidConsume(wallet: string, mode: Mode) {
  ensureWallet(wallet);
  db.prepare(`INSERT INTO runs_audit(wallet, mode, at) VALUES (?, ?, ?)`).run(
    wallet,
    mode,
    nowMs(),
  );
}

// === Submit receipts (SECURITY) ===========================
// One-shot receipt required by /api/normal/submit, /api/daily/submit, /api/superprize/submit
// TTL keeps table bounded and prevents “old receipt replay”.
const SUBMIT_RECEIPT_TTL_MS = 10 * 60_000; // 10 minutes

// Base table (we will also ensure column "seed" exists via migration below)
db.prepare(
  `
  CREATE TABLE IF NOT EXISTS run_submit_receipts (
    id TEXT PRIMARY KEY,
    wallet TEXT NOT NULL,
    mode TEXT NOT NULL,
    seed INTEGER NOT NULL DEFAULT 0,
    createdAt INTEGER NOT NULL,
    expiresAt INTEGER NOT NULL
  )
`,
).run();

db.prepare(
  `CREATE INDEX IF NOT EXISTS run_submit_receipts_wallet_mode_expires
   ON run_submit_receipts(wallet, mode, expiresAt);`,
).run();

db.prepare(
  `
  CREATE TABLE IF NOT EXISTS run_payment_intents (
    reference TEXT PRIMARY KEY,
    wallet TEXT NOT NULL,
    mode TEXT NOT NULL,
    lamports INTEGER NOT NULL,
    createdAt INTEGER NOT NULL,
    used INTEGER NOT NULL DEFAULT 0
  );
`,
).run();

db.prepare(
  `
  CREATE INDEX IF NOT EXISTS run_payment_intents_wallet_mode_created
  ON run_payment_intents(wallet, mode, createdAt);
`,
).run();

export function createRunPaymentIntent(args: {
  wallet: string;
  mode: Mode;
  lamports: number;
}): { ok: true; reference: string } | { ok: false; error: string } {
  const wallet = String(args.wallet || "").trim();
  const mode = args.mode;
  const lamports = Math.max(0, Math.floor(Number(args.lamports || 0)));

  if (!wallet || wallet.length < 8) return { ok: false, error: "BAD_WALLET" };
  if (mode !== "normal" && mode !== "daily" && mode !== "superprize")
    return { ok: false, error: "BAD_MODE" };
  if (lamports <= 0) return { ok: false, error: "BAD_AMOUNT" };

  const reference = `ref_${uid()}`;
  db.prepare(
    `INSERT INTO run_payment_intents(reference,wallet,mode,lamports,createdAt,used)
     VALUES(?,?,?,?,?,0)`,
  ).run(reference, wallet, mode, lamports, nowMs());

  return { ok: true, reference };
}

export function consumeRunPaymentIntent(args: {
  reference: string;
  wallet: string;
  mode: Mode;
}): { ok: true; lamports: number } | { ok: false; error: string } {
  const reference = String(args.reference || "").trim();
  const wallet = String(args.wallet || "").trim();
  const mode = args.mode;

  if (!reference) return { ok: false, error: "MISSING_REFERENCE" };

  const tx = db.transaction(() => {
    const row = db
      .prepare(
        `SELECT reference,wallet,mode,lamports,used
         FROM run_payment_intents WHERE reference=?`,
      )
      .get(reference) as
      | {
          reference: string;
          wallet: string;
          mode: string;
          lamports: number;
          used: number;
        }
      | undefined;

    if (!row) return { ok: false as const, error: "BAD_REFERENCE" };
    if (row.used === 1) return { ok: false as const, error: "REFERENCE_USED" };
    if (row.wallet !== wallet)
      return { ok: false as const, error: "BAD_REFERENCE" };
    if (row.mode !== mode)
      return { ok: false as const, error: "BAD_REFERENCE" };

    db.prepare(`UPDATE run_payment_intents SET used=1 WHERE reference=?`).run(
      reference,
    );
    return {
      ok: true as const,
      lamports: Math.max(0, Math.floor(row.lamports)),
    };
  });

  return tx();
}

/**
 * One-time lightweight migration: add seed column if older DB exists.
 * Safe to run at startup.
 */
(function ensureReceiptSeedColumn() {
  try {
    const cols = db
      .prepare(`PRAGMA table_info(run_submit_receipts)`)
      .all() as Array<{ name: string }>;
    const hasSeed = cols.some((c) => c.name === "seed");
    if (hasSeed) return;

    // Older DB: add column with default 0 (NOT NULL in SQLite requires DEFAULT)
    db.prepare(
      `ALTER TABLE run_submit_receipts ADD COLUMN seed INTEGER NOT NULL DEFAULT 0`,
    ).run();
  } catch {
    // ignore (table may not exist yet; create above already handles)
  }
})();

function randomSeed(): number {
  // 1..2^31-1 (stable int range)
  try {
    return crypto.randomInt(1, 2_147_483_647);
  } catch {
    // fallback
    return Math.floor(Math.random() * 2_147_483_646) + 1;
  }
}

function issueSubmitReceipt(
  wallet: string,
  mode: Mode,
): { id: string; seed: number } | null {
  const w = String(wallet || "").trim();
  if (!w || w.length < 8) return null;

  const t = nowMs();
  const id = `rsr_${uid()}`;
  const expiresAt = t + SUBMIT_RECEIPT_TTL_MS;
  const seed = randomSeed();

  db.prepare(
    `INSERT INTO run_submit_receipts(id,wallet,mode,seed,createdAt,expiresAt)
     VALUES(?,?,?,?,?,?)`,
  ).run(id, w, mode, seed, t, expiresAt);

  // best-effort cleanup
  try {
    db.prepare(`DELETE FROM run_submit_receipts WHERE expiresAt < ?`).run(t);
  } catch {
    // ignore
  }

  return { id, seed };
}

/**
 * Consume a submit receipt (atomic, one-shot).
 * Used by /api/normal/submit, /api/daily/submit, /api/superprize/submit.
 */
export function consumeSubmitReceipt(args: {
  id: string;
  wallet: string;
  mode: Mode;
}):
  | { ok: true; createdAt: number; seed: number }
  | { ok: false; error: string } {
  const id = String(args.id || "").trim();
  const wallet = String(args.wallet || "").trim();
  const mode = args.mode;

  if (!id) return { ok: false, error: "MISSING_RECEIPT" };
  if (!wallet || wallet.length < 8) return { ok: false, error: "BAD_WALLET" };
  if (mode !== "normal" && mode !== "daily" && mode !== "superprize") {
    return { ok: false, error: "BAD_MODE" };
  }

  const t = nowMs();

  const tx = db.transaction(() => {
    const row = db
      .prepare(
        `SELECT id, wallet, mode, seed, createdAt, expiresAt
         FROM run_submit_receipts
         WHERE id=?`,
      )
      .get(id) as
      | {
          id: string;
          wallet: string;
          mode: string;
          seed: number;
          createdAt: number;
          expiresAt: number;
        }
      | undefined;

    if (!row) return { ok: false as const, error: "BAD_RECEIPT" };
    if (row.wallet !== wallet)
      return { ok: false as const, error: "BAD_RECEIPT" };
    if (row.mode !== mode) return { ok: false as const, error: "BAD_RECEIPT" };

    if (t > row.expiresAt) {
      db.prepare(`DELETE FROM run_submit_receipts WHERE id=?`).run(id);
      return { ok: false as const, error: "RECEIPT_EXPIRED" };
    }

    db.prepare(`DELETE FROM run_submit_receipts WHERE id=?`).run(id);

    const seed = Math.floor(Number(row.seed || 0));
    return {
      ok: true as const,
      createdAt: row.createdAt,
      seed: seed > 0 ? seed : 0,
    };
  });

  return tx();
}

function ensureWallet(wallet: string) {
  db.prepare(
    `
    INSERT OR IGNORE INTO runs (
      wallet, free, normalPaid, dailyPaid, superprizePaid, updatedAt
    )
    VALUES (?, 0, 0, 0, 0, ?)
  `,
  ).run(wallet, nowMs());
}

/**
 * Ensure daily state exists and resets free runs when UTC day changes.
 * This enforces: "Unused free runs expire at 00:00 UTC".
 */
function ensureDailyDay(wallet: string) {
  ensureWallet(wallet);

  const today = utcDayNow();

  const row = db
    .prepare(`SELECT day, guaranteed FROM runs_daily WHERE wallet = ?`)
    .get(wallet) as { day: string; guaranteed: number } | undefined;

  if (!row) {
    db.prepare(
      `
      INSERT INTO runs_daily(wallet, day, guaranteed, updatedAt)
      VALUES (?, ?, 0, ?)
    `,
    ).run(wallet, today, nowMs());

    // ✅ IMPORTANT:
    // Ne touche PAS à runs.free ici.
    return;
  }

  if (row.day !== today) {
    db.prepare(
      `
      UPDATE runs
      SET free = 0,
          updatedAt = ?
      WHERE wallet = ?
    `,
    ).run(nowMs(), wallet);

    db.prepare(
      `
      UPDATE runs_daily
      SET day = ?,
          guaranteed = 0,
          updatedAt = ?
      WHERE wallet = ?
    `,
    ).run(today, nowMs(), wallet);
  }
}

/** Guarantee 1 free run/day (UTC) */
export function ensureDailyGuaranteedRun(wallet: string) {
  ensureDailyDay(wallet);

  const today = utcDayNow();
  const row = db
    .prepare(`SELECT day, guaranteed FROM runs_daily WHERE wallet = ?`)
    .get(wallet) as { day: string; guaranteed: number } | undefined;

  if (!row || row.day !== today) {
    ensureDailyDay(wallet);
  }

  const row2 = db
    .prepare(`SELECT guaranteed FROM runs_daily WHERE wallet = ?`)
    .get(wallet) as { guaranteed: number } | undefined;

  if ((row2?.guaranteed ?? 0) === 1) return;

  db.prepare(
    `
    UPDATE runs
    SET free = MIN(free + 1, 6),
        updatedAt = ?
    WHERE wallet = ?
  `,
  ).run(nowMs(), wallet);

  db.prepare(
    `
    UPDATE runs_daily
    SET guaranteed = 1,
        updatedAt = ?
    WHERE wallet = ?
  `,
  ).run(nowMs(), wallet);
}

/* =========================
   READ
========================= */

export function getRunsForWallet(wallet: string): RunsState {
  ensureDailyGuaranteedRun(wallet);

  const row = db
    .prepare(
      `SELECT free, normalPaid, dailyPaid, superprizePaid
       FROM runs WHERE wallet = ?`,
    )
    .get(wallet) as RunsState | undefined;

  return {
    free: row?.free ?? 0,
    normalPaid: row?.normalPaid ?? 0,
    dailyPaid: row?.dailyPaid ?? 0,
    superprizePaid: row?.superprizePaid ?? 0,
  };
}

/* =========================
   ADMIN / FREE GRANTS
========================= */

export function grantRuns(wallet: string, amount: number) {
  ensureDailyDay(wallet);

  db.prepare(
    `
    UPDATE runs
    SET free = MIN(free + ?, 6),
        updatedAt = ?
    WHERE wallet = ?
  `,
  ).run(amount, nowMs(), wallet);
}

export function grantPaidRun(wallet: string, mode: Mode, amount = 1) {
  ensureDailyDay(wallet);

  const column =
    mode === "normal"
      ? "normalPaid"
      : mode === "daily"
        ? "dailyPaid"
        : "superprizePaid";

  db.prepare(
    `
    UPDATE runs
    SET ${column} = ${column} + ?,
        updatedAt = ?
    WHERE wallet = ?
  `,
  ).run(amount, nowMs(), wallet);
}

/* =========================
   COMPAT revokeRuns (legacy endpoints)
========================= */

export function revokeRuns(
  wallet: string,
  amount: number,
  mode: Mode | "any" = "any",
) {
  ensureDailyDay(wallet);

  const dec = (column: string) => {
    db.prepare(
      `
      UPDATE runs
      SET ${column} = MAX(${column} - ?, 0),
          updatedAt = ?
      WHERE wallet = ?
    `,
    ).run(amount, nowMs(), wallet);
  };

  if (mode === "any") {
    dec("free");
    dec("normalPaid");
    dec("dailyPaid");
    dec("superprizePaid");
  } else if (mode === "normal") {
    dec("normalPaid");
  } else if (mode === "daily") {
    dec("dailyPaid");
  } else {
    dec("superprizePaid");
  }
}

/* =========================
   ATOMIC CONSUME (legacy)
========================= */

export function consumeRun(wallet: string, mode: Mode): "free" | "paid" | null {
  ensureDailyGuaranteedRun(wallet);

  const tx = db.transaction(() => {
    const row = db
      .prepare(
        `SELECT free, normalPaid, dailyPaid, superprizePaid
         FROM runs WHERE wallet = ?`,
      )
      .get(wallet) as RunsState;

    if (row.free > 0) {
      db.prepare(
        `
        UPDATE runs
        SET free = free - 1,
            updatedAt = ?
        WHERE wallet = ?
      `,
      ).run(nowMs(), wallet);
      return "free";
    }

    const column =
      mode === "normal"
        ? "normalPaid"
        : mode === "daily"
          ? "dailyPaid"
          : "superprizePaid";

    const paidCount =
      column === "normalPaid"
        ? row.normalPaid
        : column === "dailyPaid"
          ? row.dailyPaid
          : row.superprizePaid;

    if (paidCount > 0) {
      db.prepare(
        `
        UPDATE runs
        SET ${column} = ${column} - 1,
            updatedAt = ?
        WHERE wallet = ?
      `,
      ).run(nowMs(), wallet);
      return "paid";
    }

    return null;
  });

  return tx();
}

/* =========================
   ATOMIC CONSUME + RECEIPT + SEED (SECURITY)
========================= */

/**
 * ATOMIC: consume a run, and returns a one-shot submit receipt + a run seed.
 * - normal/daily/superprize: receipt stored in run_submit_receipts (validated by /submit endpoints)
 * - free runs: still get a receipt (so submit always requires receipt) + seed
 */
export function consumeRunWithOptionalReceipt(
  wallet: string,
  mode: Mode,
): { used: "free" | "paid"; receipt: string; seed: number } | null {
  ensureDailyGuaranteedRun(wallet);

  const t = nowMs();

  const tx = db.transaction(() => {
    const row = db
      .prepare(
        `SELECT free, normalPaid, dailyPaid, superprizePaid
         FROM runs WHERE wallet = ?`,
      )
      .get(wallet) as RunsState;

    // 1) free first
    if (row.free > 0) {
      db.prepare(
        `UPDATE runs SET free = free - 1, updatedAt = ? WHERE wallet = ?`,
      ).run(t, wallet);

      const issued = issueSubmitReceipt(wallet, mode);
      if (!issued) return null;

      return { used: "free" as const, receipt: issued.id, seed: issued.seed };
    }

    // 2) paid by mode
    const column =
      mode === "normal"
        ? "normalPaid"
        : mode === "daily"
          ? "dailyPaid"
          : "superprizePaid";

    const paidCount =
      column === "normalPaid"
        ? row.normalPaid
        : column === "dailyPaid"
          ? row.dailyPaid
          : row.superprizePaid;

    if (paidCount <= 0) return null;

    db.prepare(
      `UPDATE runs SET ${column} = ${column} - 1, updatedAt = ? WHERE wallet = ?`,
    ).run(t, wallet);

    const issued = issueSubmitReceipt(wallet, mode);
    if (!issued) return null;

    return { used: "paid" as const, receipt: issued.id, seed: issued.seed };
  });

  return tx();
}
