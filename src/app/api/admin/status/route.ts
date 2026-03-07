import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function safeJson(url: string) {
  const r = await fetch(url, { cache: "no-store" }).catch(() => null);
  if (!r || !r.ok) return null;
  return (await r.json().catch(() => null)) as unknown;
}

export async function GET(req: NextRequest) {
  const origin = new URL(req.url).origin;

  const [normal, daily, superprize] = await Promise.all([
    safeJson(`${origin}/api/normal/status`),
    safeJson(`${origin}/api/daily/status`),
    safeJson(`${origin}/api/superprize/status`),
  ]);

  return NextResponse.json({
    ok: true,
    normal,
    daily,
    superprize,
  });
}
