import { NextRequest, NextResponse } from "next/server";
import { enterScore, getActiveEvent } from "@/server/superprize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function bad(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return bad("FORBIDDEN", 403);
  }

  const body = (await req.json().catch(() => null)) as {
    wallet?: string;
    name?: string;
    score?: number;
  } | null;

  const wallet = String(body?.wallet || "").trim();
  const name = String(body?.name || "").trim();
  const score = Math.max(0, Math.floor(Number(body?.score || 0)));

  if (!wallet) return bad("MISSING_WALLET");
  if (!name) return bad("MISSING_NAME");

  const ev = getActiveEvent();
  if (!ev) return bad("NO_ACTIVE_EVENT");

  const res = enterScore({
    wallet,
    name,
    score,
    startedAt: Date.now(),
  });

  return NextResponse.json({
    ok: true,
    submit: res,
    event: getActiveEvent(),
  });
}
