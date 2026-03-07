// src/app/api/daily/history/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getDailyHistory } from "@/server/daily";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);

  const limit = Number(url.searchParams.get("limit") || "50");
  const offset = Number(url.searchParams.get("offset") || "0");

  const safeLimit =
    Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 50;
  const safeOffset =
    Number.isFinite(offset) && offset >= 0 ? Math.floor(offset) : 0;

  const res = getDailyHistory(safeLimit, safeOffset);

  return NextResponse.json(res);
}
