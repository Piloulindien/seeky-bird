// src/app/api/normal/history/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getNormalHistory } from "@/server/normalCore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const limit = Number(url.searchParams.get("limit") || "50");
  const offset = Number(url.searchParams.get("offset") || "0");
  return NextResponse.json(getNormalHistory(limit, offset));
}
