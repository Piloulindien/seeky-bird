// src/app/api/superprize/events/route.ts
import { NextResponse } from "next/server";
import { db } from "@/server/db";
import type { SuperPrizeEvent, SuperPrizeStatus } from "@/server/superprize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Row = SuperPrizeEvent;

function statusRank(s: SuperPrizeStatus): number {
  // live first, then frozen, then settled
  if (s === "live") return 0;
  if (s === "frozen") return 1;
  return 2;
}

export async function GET(req: Request) {
  const url = new URL(req.url);

  const limit = Math.min(
    100,
    Math.max(1, Math.floor(Number(url.searchParams.get("limit") || "50"))),
  );
  const offset = Math.max(
    0,
    Math.floor(Number(url.searchParams.get("offset") || "0")),
  );
  const includeSettled = String(url.searchParams.get("settled") || "1") !== "0";

  // We expose minimal fields for UI picker.
  // Note: We don't depend on listArchivedEvents() because we want live/frozen too.
  const rows = db
    .prepare(
      `SELECT *
       FROM superprize_events
       ${includeSettled ? "" : "WHERE status IN ('live','frozen')"}
       ORDER BY endAt DESC
       LIMIT ? OFFSET ?`,
    )
    .all(limit, offset) as Row[];

  const events = (rows || [])
    .map((e) => ({
      id: String(e.id || ""),
      status: String(e.status || "settled") as SuperPrizeStatus,
      startAt: Number(e.startAt || 0),
      endAt: Number(e.endAt || 0),
      prizePoolSol: Number(e.prizePoolSol || 0),
      entrySol: Number(e.entrySol || 0),
      entriesCount: Number(e.entriesCount || 0),
    }))
    .filter((e) => e.id)
    .sort((a, b) => {
      const sr = statusRank(a.status) - statusRank(b.status);
      if (sr !== 0) return sr;
      return (b.endAt || 0) - (a.endAt || 0);
    });

  return NextResponse.json({
    items: events,
    limit,
    offset,
  });
}
