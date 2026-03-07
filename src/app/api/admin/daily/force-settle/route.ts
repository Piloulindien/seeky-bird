import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/server/admin";
import { adminForceSettleDay } from "@/server/daily";

export async function POST(req: NextRequest) {
  if (!requireAdmin(req)) {
    return NextResponse.json(
      { ok: false, error: "UNAUTHORIZED" },
      { status: 401 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const day = body.day;

  const res = adminForceSettleDay(day);

  return NextResponse.json(res);
}
