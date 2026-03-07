// src/app/api/superprize/archive/route.ts
import { NextRequest, NextResponse } from "next/server";
import { listArchivedEvents } from "@/server/superprize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const limit = Math.min(
    50,
    Math.max(1, Number(url.searchParams.get("limit") || 20)),
  );
  const offset = Math.max(0, Number(url.searchParams.get("offset") || 0));

  const res = listArchivedEvents({ limit, offset });
  return NextResponse.json(res);
}
