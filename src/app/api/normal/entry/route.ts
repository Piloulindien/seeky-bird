// src/app/api/normal/entry/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  return NextResponse.json(
    { ok: false, error: "DEPRECATED_USE_/api/play/consume" },
    { status: 410 },
  );
}
