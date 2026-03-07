// src/server/db.ts
import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), ".data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const dbPath = path.join(DATA_DIR, "seeky.sqlite");
export const db = new Database(dbPath);

// Pragmas (safe defaults for server)
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("synchronous = NORMAL");

export function nowMs(): number {
  return Date.now();
}

/**
 * Compat: certains fichiers appellent uid("superprize")
 * -> on accepte un prefix optionnel
 */
export function uid(prefix?: string): string {
  const id = crypto.randomUUID();
  return prefix ? `${prefix}_${id}` : id;
}

db.exec(`
/* =========================
   USERS
========================= */
CREATE TABLE IF NOT EXISTS users (
  wallet TEXT PRIMARY KEY,
  name   TEXT NOT NULL
);

/* =========================
   RUNS (free + paid per mode)
========================= */
CREATE TABLE IF NOT EXISTS runs (
  wallet         TEXT PRIMARY KEY,
  free           INTEGER NOT NULL DEFAULT 0,
  normalPaid     INTEGER NOT NULL DEFAULT 0,
  dailyPaid      INTEGER NOT NULL DEFAULT 0,
  superprizePaid INTEGER NOT NULL DEFAULT 0,
  updatedAt      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_runs_updatedAt ON runs(updatedAt);

/* =========================
   NORMAL
========================= */
CREATE TABLE IF NOT EXISTS normal_rounds (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  status       TEXT NOT NULL CHECK(status IN ('live','locked','settled')),
  createdAt    INTEGER NOT NULL,
  lockedAt     INTEGER,
  settledAt    INTEGER,
  poolSol      REAL    NOT NULL DEFAULT 0,
  entriesCount INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_normal_rounds_status_id ON normal_rounds(status, id DESC);
CREATE INDEX IF NOT EXISTS idx_normal_rounds_lockedAt ON normal_rounds(lockedAt);

CREATE TABLE IF NOT EXISTS normal_entries (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  roundId   INTEGER NOT NULL,
  wallet    TEXT    NOT NULL,
  name      TEXT    NOT NULL,
  score     INTEGER NOT NULL,
  startedAt INTEGER NOT NULL,
  createdAt INTEGER NOT NULL,
  FOREIGN KEY(roundId) REFERENCES normal_rounds(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_normal_entries_round_score ON normal_entries(roundId, score DESC, createdAt ASC);
CREATE INDEX IF NOT EXISTS idx_normal_entries_round_wallet ON normal_entries(roundId, wallet);

CREATE TABLE IF NOT EXISTS normal_payouts (
  roundId   INTEGER NOT NULL,
  rank      INTEGER NOT NULL,
  wallet    TEXT    NOT NULL,
  name      TEXT    NOT NULL,
  score     INTEGER NOT NULL,
  amountSol REAL    NOT NULL,
  PRIMARY KEY(roundId, rank),
  FOREIGN KEY(roundId) REFERENCES normal_rounds(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS normal_distributions (
  roundId     INTEGER PRIMARY KEY,
  at          INTEGER NOT NULL,
  poolSol     REAL    NOT NULL,
  payoutTxSigs TEXT,
  FOREIGN KEY(roundId) REFERENCES normal_rounds(id) ON DELETE CASCADE
);

/* =========================
   DAILY
========================= */
CREATE TABLE IF NOT EXISTS daily_days (
  day         TEXT PRIMARY KEY, -- YYYY-MM-DD
  status      TEXT NOT NULL CHECK(status IN ('open','settled')),
  createdAt   INTEGER NOT NULL,
  settledAt   INTEGER,
  poolSol     REAL    NOT NULL DEFAULT 0,
  entriesCount INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_daily_days_status_day ON daily_days(status, day);

CREATE TABLE IF NOT EXISTS daily_entries (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  day       TEXT    NOT NULL,
  wallet    TEXT    NOT NULL,
  name      TEXT    NOT NULL,
  score     INTEGER NOT NULL,
  startedAt INTEGER NOT NULL,
  createdAt INTEGER NOT NULL,
  FOREIGN KEY(day) REFERENCES daily_days(day) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_daily_entries_day_score ON daily_entries(day, score DESC, createdAt ASC);
CREATE INDEX IF NOT EXISTS idx_daily_entries_day_wallet ON daily_entries(day, wallet);

CREATE TABLE IF NOT EXISTS daily_payouts (
  day       TEXT    NOT NULL,
  rank      INTEGER NOT NULL,
  wallet    TEXT    NOT NULL,
  name      TEXT    NOT NULL,
  score     INTEGER NOT NULL,
  amountSol REAL    NOT NULL,
  PRIMARY KEY(day, rank),
  FOREIGN KEY(day) REFERENCES daily_days(day) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS daily_distributions (
  day         TEXT PRIMARY KEY,
  at          INTEGER NOT NULL,
  poolSol     REAL    NOT NULL,
  payoutTxSigs TEXT,
  FOREIGN KEY(day) REFERENCES daily_days(day) ON DELETE CASCADE
);

/* =========================
   SUPERPRIZE
========================= */
CREATE TABLE IF NOT EXISTS superprize_events (
  id           TEXT PRIMARY KEY,
  status       TEXT NOT NULL CHECK(status IN ('live','frozen','settled')),
  startAt      INTEGER NOT NULL,
  endAt        INTEGER NOT NULL,
  freezeAt     INTEGER NOT NULL,
  prizePoolSol REAL    NOT NULL DEFAULT 0,
  entrySol     REAL    NOT NULL DEFAULT 0,
  totalEntrySol REAL   NOT NULL DEFAULT 0,
  entriesCount INTEGER NOT NULL DEFAULT 0,
  createdAt    INTEGER NOT NULL,
  settledAt    INTEGER,
  payoutTxSigs TEXT
);

CREATE INDEX IF NOT EXISTS idx_superprize_events_status_createdAt ON superprize_events(status, createdAt DESC);

CREATE TABLE IF NOT EXISTS superprize_entries (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  eventId   TEXT    NOT NULL,
  wallet    TEXT    NOT NULL,
  name      TEXT    NOT NULL,
  score     INTEGER NOT NULL,
  startedAt INTEGER NOT NULL,
  createdAt INTEGER NOT NULL,
  FOREIGN KEY(eventId) REFERENCES superprize_events(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_superprize_entries_event_score ON superprize_entries(eventId, score DESC, createdAt ASC);
CREATE INDEX IF NOT EXISTS idx_superprize_entries_event_wallet ON superprize_entries(eventId, wallet);

CREATE TABLE IF NOT EXISTS superprize_winners (
  eventId   TEXT    NOT NULL,
  rank      INTEGER NOT NULL,
  wallet    TEXT    NOT NULL,
  name      TEXT    NOT NULL,
  score     INTEGER NOT NULL,
  amountSol REAL    NOT NULL,
  PRIMARY KEY(eventId, rank),
  FOREIGN KEY(eventId) REFERENCES superprize_events(id) ON DELETE CASCADE
);
`);
