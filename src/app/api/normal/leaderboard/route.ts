// src/app/api/normal/leaderboard/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getRoundById, getNormalTop10 } from "@/server/normalCore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const rid = Number(url.searchParams.get("round") || "0");

  if (!rid) {
    return NextResponse.json(
      { ok: false, error: "MISSING_ROUND" },
      { status: 400 },
    );
  }

  const round = getRoundById(rid);
  if (!round) {
    return NextResponse.json(
      { ok: false, error: "ROUND_NOT_FOUND" },
      { status: 404 },
    );
  }

  const top = getNormalTop10(rid);
  return NextResponse.json({ ok: true, roundId: rid, top });
}
