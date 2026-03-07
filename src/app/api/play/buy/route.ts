import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
  "Surrogate-Control": "no-store",
};

export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error: "DISABLED_ROUTE",
      message: "Use /api/runs/buy-intent then /api/runs/confirm for paid runs.",
    },
    { status: 410, headers: NO_STORE_HEADERS },
  );
}
