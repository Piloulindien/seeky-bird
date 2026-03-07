import { NextRequest, NextResponse } from "next/server";
import { getDailyStatus } from "@/server/daily";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const day = String(url.searchParams.get("day") || "").trim();
  return NextResponse.json(getDailyStatus(day || undefined));
}
