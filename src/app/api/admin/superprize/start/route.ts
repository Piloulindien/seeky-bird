import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/server/admin";
import { startEvent } from "@/server/superprize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!requireAdmin(req)) {
    return NextResponse.json(
      { ok: false, error: "UNAUTHORIZED" },
      { status: 401 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const prizePoolSol = Number(body?.prizePoolSol || 0);
  const entrySol = Number(body?.entrySol || 0);
  const durationHours = Number(body?.durationHours || 48);

  const event = startEvent({ prizePoolSol, entrySol, durationHours });
  return NextResponse.json({ ok: true, event });
}
