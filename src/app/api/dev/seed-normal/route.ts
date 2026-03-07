import { NextRequest, NextResponse } from "next/server";
import {
  submitNormalScore,
  recordNormalEntry,
  getNormalStatus,
} from "@/server/normalCore";

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
    startedAt?: number;
    entries?: number;
  } | null;

  const wallet = String(body?.wallet || "").trim();
  const name = String(body?.name || "").trim();
  const score = Math.max(0, Math.floor(Number(body?.score || 0)));
  const startedAt = Math.floor(Number(body?.startedAt || Date.now()));
  const entries = Math.max(1, Math.floor(Number(body?.entries || 1)));

  if (!wallet) return bad("MISSING_WALLET");
  if (!name) return bad("MISSING_NAME");

  for (let i = 0; i < entries; i++) {
    recordNormalEntry();
  }

  const status = getNormalStatus();
  const roundId = status.round.id;

  const res = submitNormalScore({
    wallet,
    name,
    score,
    startedAt,
    roundId,
  });

  if (!res.ok) {
    return NextResponse.json(res, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    roundId,
    status,
  });
}
