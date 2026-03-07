// src/server/superprize.ts
import { db, nowMs, uid } from "./db";

export type SuperPrizeStatus = "live" | "frozen" | "settling" | "settled";

/**
 * ✅ Grace après fin d'event pour laisser finir les runs
 */
const SUPERPRIZE_END_GRACE_MS = 180_000;

type SuperPrizeEventRow = {
  id: string;
  status: SuperPrizeStatus;
  startAt: number;
  endAt: number;
  freezeAt: number;
  prizePoolSol: number;
  entrySol: number;
  totalEntrySol: number;
  entriesCount: number;
  createdAt: number;
  settledAt: number | null;
  payoutTxSigs?: string | null;
};

export type SuperPrizeEvent = Omit<SuperPrizeEventRow, "payoutTxSigs"> & {
  payoutTxSigs: string[];
};

export type SuperPrizeTopRow = {
  wallet: string;
  name: string;
  score: number;
};

export type SuperPrizeWinnerRow = {
  rank: number;
  wallet: string;
  name: string;
  score: number;
  amountSol: number;
};

export type SuperPrizeLeaderboard = {
  event: SuperPrizeEvent | null;
  top: SuperPrizeTopRow[];
  winners: SuperPrizeWinnerRow[];
};

const SPLIT = [0.5, 0.3, 0.2] as const;

function parseTxSigs(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw))
    return raw.map((x) => String(x || "").trim()).filter(Boolean);

  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s) return [];
    try {
      const j = JSON.parse(s) as unknown;
      if (Array.isArray(j))
        return j.map((x) => String(x || "").trim()).filter(Boolean);
      return [];
    } catch {
      return [];
    }
  }

  return [];
}

function normalizeEvent(row: SuperPrizeEventRow): SuperPrizeEvent {
  return {
    ...row,
    payoutTxSigs: parseTxSigs(row.payoutTxSigs),
  };
}

export function setEventPayoutTxSigs(eventId: string, sigs: string[]) {
  const id = String(eventId || "").trim();
  if (!id) return;

  const cleaned = (sigs || [])
    .map((x) => String(x || "").trim())
    .filter(Boolean);

  db.prepare(`UPDATE superprize_events SET payoutTxSigs=? WHERE id=?`).run(
    JSON.stringify(cleaned),
    id,
  );
}

export function getEventById(id: string): SuperPrizeEvent | null {
  const row = db
    .prepare(`SELECT * FROM superprize_events WHERE id=?`)
    .get(id) as SuperPrizeEventRow | undefined;
  return row ? normalizeEvent(row) : null;
}

export function getActiveEvent(): SuperPrizeEvent | null {
  const row = db
    .prepare(
      `SELECT * FROM superprize_events
     WHERE status IN ('live','frozen')
     ORDER BY createdAt DESC
     LIMIT 1`,
    )
    .get() as SuperPrizeEventRow | undefined;

  if (!row) return null;

  const t = nowMs();

  if (row.status === "live" && t >= row.endAt) {
    db.prepare(`UPDATE superprize_events SET status='frozen' WHERE id=?`).run(
      row.id,
    );
    const updated = getEventById(row.id);
    return updated ? updated : normalizeEvent({ ...row, status: "frozen" });
  }

  return normalizeEvent(row);
}

export function startEvent(args: {
  prizePoolSol: number;
  entrySol: number;
  durationHours?: number;
}): SuperPrizeEvent {
  const existing = getActiveEvent();
  if (existing) return existing;

  const t = nowMs();
  const duration = Math.max(1, Math.floor(args.durationHours ?? 48));
  const endAt = t + duration * 60 * 60 * 1000;

  const freezeAt = endAt;

  const ev: SuperPrizeEventRow = {
    id: `superprize_${uid()}`,
    status: "live",
    startAt: t,
    endAt,
    freezeAt,
    prizePoolSol: Math.max(0, Number(args.prizePoolSol || 0)),
    entrySol: Math.max(0, Number(args.entrySol || 0)),
    totalEntrySol: 0,
    entriesCount: 0,
    createdAt: t,
    settledAt: null,
    payoutTxSigs: JSON.stringify([]),
  };

  db.prepare(
    `INSERT INTO superprize_events
      (id,status,startAt,endAt,freezeAt,prizePoolSol,entrySol,totalEntrySol,entriesCount,createdAt,settledAt,payoutTxSigs)
     VALUES
      (@id,@status,@startAt,@endAt,@freezeAt,@prizePoolSol,@entrySol,@totalEntrySol,@entriesCount,@createdAt,@settledAt,@payoutTxSigs)`,
  ).run(ev);

  return normalizeEvent(ev);
}

/**
 * ✅ Score submit
 * - startedAt doit exister (NOT NULL en DB)
 */
export function enterScore(args: {
  wallet: string;
  name: string;
  score: number;
  startedAt: number; // ✅ obligatoire côté serveur maintenant
}): { ok: true; event: SuperPrizeEvent } | { ok: false; error: string } {
  const ev = getActiveEvent();
  if (!ev) return { ok: false, error: "NO_ACTIVE_EVENT" };

  const t = nowMs();

  const startedAt = Math.floor(Number(args.startedAt || 0));
  if (!startedAt) return { ok: false, error: "BAD_STARTED_AT" };

  if (startedAt < ev.startAt - 60_000)
    return { ok: false, error: "BAD_STARTED_AT" };
  if (startedAt > ev.endAt) return { ok: false, error: "STARTED_AFTER_END" };
  if (t > ev.endAt + SUPERPRIZE_END_GRACE_MS)
    return { ok: false, error: "EVENT_ENDED" };

  const wallet = (args.wallet || "").trim();
  const name = (args.name || "").trim();
  const score = Math.max(0, Math.floor(Number(args.score || 0)));

  if (!wallet || wallet.length < 8) return { ok: false, error: "BAD_WALLET" };
  if (!name || name.length < 2) return { ok: false, error: "BAD_NAME" };

  const existingUser = db
    .prepare(`SELECT name FROM users WHERE wallet=?`)
    .get(wallet) as { name: string } | undefined;

  if (!existingUser) {
    db.prepare(`INSERT INTO users(wallet,name) VALUES(?,?)`).run(wallet, name);
  } else if (existingUser.name !== name) {
    return { ok: false, error: "NAME_IMMUTABLE" };
  }

  // ✅ FIX: startedAt est NOT NULL en DB => on l'insère
  db.prepare(
    `INSERT INTO superprize_entries(eventId,wallet,name,score,startedAt,createdAt)
     VALUES(?,?,?,?,?,?)`,
  ).run(ev.id, wallet, name, score, startedAt, t);

  db.prepare(
    `UPDATE superprize_events
     SET entriesCount = entriesCount + 1,
         totalEntrySol = totalEntrySol + ?
     WHERE id=?`,
  ).run(ev.entrySol, ev.id);

  const updated = getEventById(ev.id)!;
  return { ok: true, event: updated };
}

export function getLeaderboard(eventId?: string): SuperPrizeLeaderboard {
  const ev = eventId ? getEventById(eventId) : getActiveEvent();
  if (!ev) return { event: null, top: [], winners: [] };

  const top = db
    .prepare(
      `SELECT wallet, name, score
       FROM superprize_entries
       WHERE eventId=?
       ORDER BY score DESC, createdAt ASC
       LIMIT 50`,
    )
    .all(ev.id) as SuperPrizeTopRow[];

  const winners = db
    .prepare(
      `SELECT rank, wallet, name, score, amountSol
       FROM superprize_winners
       WHERE eventId=?
       ORDER BY rank ASC`,
    )
    .all(ev.id) as SuperPrizeWinnerRow[];

  return { event: ev, top, winners };
}

export function finalizeEvent():
  | { ok: true; event: SuperPrizeEvent; winners: SuperPrizeWinnerRow[] }
  | { ok: false; error: string } {
  const current = db
    .prepare(
      `SELECT * FROM superprize_events
       WHERE status IN ('live','frozen','settling','settled')
       ORDER BY createdAt DESC
       LIMIT 1`,
    )
    .get() as SuperPrizeEventRow | undefined;

  if (!current) return { ok: false, error: "NO_EVENT" };

  const ev = normalizeEvent(current);
  const t = nowMs();

  if (ev.status === "settled") {
    const { winners, event } = getLeaderboard(ev.id);
    return { ok: true, event: event!, winners };
  }

  if (ev.status === "settling") {
    return { ok: false, error: "SETTLING_IN_PROGRESS" };
  }

  if (ev.status === "live" && t < ev.endAt + SUPERPRIZE_END_GRACE_MS) {
    return { ok: false, error: "EVENT_NOT_ENDED" };
  }

  if (ev.status !== "frozen" && ev.status !== "live") {
    return { ok: false, error: "BAD_EVENT_STATUS" };
  }

  // lock: only one caller can switch frozen/live -> settling
  const lockRes = db
    .prepare(
      `UPDATE superprize_events
       SET status='settling'
       WHERE id=? AND status IN ('live','frozen')`,
    )
    .run(ev.id);

  if (lockRes.changes !== 1) {
    const latest = getEventById(ev.id);
    if (latest?.status === "settled") {
      const { winners, event } = getLeaderboard(ev.id);
      return { ok: true, event: event!, winners };
    }
    return { ok: false, error: "SETTLING_IN_PROGRESS" };
  }

  const rows = db
    .prepare(
      `SELECT wallet, name, score, createdAt
       FROM superprize_entries
       WHERE eventId=?
       ORDER BY score DESC, createdAt ASC`,
    )
    .all(ev.id) as Array<{
    wallet: string;
    name: string;
    score: number;
    createdAt: number;
  }>;

  const uniq: Array<{ wallet: string; name: string; score: number }> = [];
  const seen = new Set<string>();

  for (const r of rows) {
    if (seen.has(r.wallet)) continue;
    seen.add(r.wallet);
    uniq.push({ wallet: r.wallet, name: r.name, score: r.score });
    if (uniq.length >= 3) break;
  }

  const payouts: SuperPrizeWinnerRow[] = uniq.map((u, i) => ({
    rank: i + 1,
    wallet: u.wallet,
    name: u.name,
    score: u.score,
    amountSol: Number((ev.prizePoolSol * SPLIT[i]).toFixed(6)),
  }));

  try {
    const tx = db.transaction(() => {
      db.prepare(`DELETE FROM superprize_winners WHERE eventId=?`).run(ev.id);

      for (const p of payouts) {
        db.prepare(
          `INSERT INTO superprize_winners(eventId,rank,wallet,name,score,amountSol)
           VALUES(?,?,?,?,?,?)`,
        ).run(ev.id, p.rank, p.wallet, p.name, p.score, p.amountSol);
      }

      db.prepare(
        `UPDATE superprize_events
         SET status='settled', settledAt=?
         WHERE id=?`,
      ).run(t, ev.id);
    });

    tx();
  } catch (err) {
    // if something fails after lock, revert status so admin can retry
    db.prepare(
      `UPDATE superprize_events
       SET status='frozen'
       WHERE id=? AND status='settling'`,
    ).run(ev.id);

    return {
      ok: false,
      error: err instanceof Error ? err.message : "FINALIZE_FAILED",
    };
  }

  const updated = getEventById(ev.id)!;
  return { ok: true, event: updated, winners: payouts };
}

export function recordEntry(args: {
  amountSol: number;
}): { ok: true; event: SuperPrizeEvent } | { ok: false; error: string } {
  const ev = getActiveEvent();
  if (!ev) return { ok: false, error: "NO_ACTIVE_EVENT" };

  const t = nowMs();
  if (t > ev.endAt + SUPERPRIZE_END_GRACE_MS)
    return { ok: false, error: "EVENT_ENDED" };

  const amount = Math.max(0, Number(args.amountSol ?? ev.entrySol ?? 0.01));

  db.prepare(
    `UPDATE superprize_events
     SET entriesCount = entriesCount + 1,
         totalEntrySol = totalEntrySol + ?
     WHERE id=?`,
  ).run(amount, ev.id);

  const updated = getEventById(ev.id)!;
  return { ok: true, event: updated };
}

export type SuperPrizeArchiveItem = {
  event: SuperPrizeEvent;
  winners: Array<{
    rank: number;
    wallet: string;
    name: string;
    score: number;
    amountSol: number;
  }>;
};

export function listArchivedEvents(args?: {
  limit?: number;
  offset?: number;
}): { items: SuperPrizeArchiveItem[]; limit: number; offset: number } {
  const limit = Math.min(50, Math.max(1, Math.floor(args?.limit ?? 20)));
  const offset = Math.max(0, Math.floor(args?.offset ?? 0));

  const events = db
    .prepare(
      `SELECT *
       FROM superprize_events
       WHERE status='settled'
       ORDER BY endAt DESC
       LIMIT ? OFFSET ?`,
    )
    .all(limit, offset) as SuperPrizeEventRow[];

  if (!events.length) return { items: [], limit, offset };

  const wStmt = db.prepare(
    `SELECT rank, wallet, name, score, amountSol
     FROM superprize_winners
     WHERE eventId=?
     ORDER BY rank ASC`,
  );

  const items: SuperPrizeArchiveItem[] = events.map((ev) => {
    const winners = wStmt.all(ev.id) as Array<{
      rank: number;
      wallet: string;
      name: string;
      score: number;
      amountSol: number;
    }>;

    return { event: normalizeEvent(ev), winners };
  });

  return { items, limit, offset };
}
