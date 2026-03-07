import { NextRequest, NextResponse } from "next/server";
import { getActiveEvent } from "@/server/superprize";
import { grantPaidRun } from "@/server/runsStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    wallet?: string;
  } | null;
  const wallet = String(body?.wallet || "").trim();

  if (!wallet || wallet.length < 8) {
    return NextResponse.json(
      { ok: false, error: "BAD_WALLET" },
      { status: 400 },
    );
  }

  const ev = getActiveEvent();
  if (!ev || ev.status !== "live") {
    return NextResponse.json(
      { ok: false, error: "NO_LIVE_EVENT" },
      { status: 400 },
    );
  }

  grantPaidRun(wallet, "superprize", 1);
  return NextResponse.json({ ok: true });
}
