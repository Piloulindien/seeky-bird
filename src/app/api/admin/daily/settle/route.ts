import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/server/admin";
import { getDailyStatus } from "@/server/daily";

export async function POST(req: NextRequest) {
  if (!requireAdmin(req)) {
    return NextResponse.json(
      { ok: false, error: "UNAUTHORIZED" },
      { status: 401 },
    );
  }

  const status = getDailyStatus(); // déclenche settlePastDaysIfReady()

  return NextResponse.json({
    ok: true,
    status,
  });
}
