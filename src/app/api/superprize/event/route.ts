// src/app/api/superprize/event/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getEventById, getLeaderboard } from "@/server/superprize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const id = String(url.searchParams.get("id") || "").trim();
  if (!id) return NextResponse.json({ event: null, top: [], winners: [] });

  const ev = getEventById(id);
  if (!ev) return NextResponse.json({ event: null, top: [], winners: [] });

  const { top, winners } = getLeaderboard(ev.id);

  return NextResponse.json({
    event: ev, // includes payoutTxSigs: string[]
    top,
    winners,
  });
}
