import { NextRequest, NextResponse } from "next/server";
import {
  recordDailyEntry,
  submitDailyScore,
  getDailyStatus,
} from "@/server/daily";

export async function POST(req: NextRequest) {
  const body = await req.json();

  const wallet = String(body.wallet);
  const name = String(body.name);
  const score = Number(body.score || 0);
  const entries = Number(body.entries || 1);
  const day = body.day;

  for (let i = 0; i < entries; i++) {
    recordDailyEntry(day);
  }

  const res = submitDailyScore({
    wallet,
    name,
    score,
    startedAt: Date.now(),
    day,
  });

  const status = getDailyStatus(day);

  return NextResponse.json({
    ok: true,
    submit: res,
    status,
  });
}
