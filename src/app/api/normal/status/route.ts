// src/app/api/normal/status/route.ts
import { NextResponse } from "next/server";
import { getNormalStatus } from "@/server/normalCore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getNormalStatus());
}
