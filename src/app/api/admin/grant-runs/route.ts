import { NextRequest, NextResponse } from "next/server";
import { grantRuns, grantPaidRun, type Mode } from "@/server/runsStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GrantBody = {
  wallet?: string;
  amount?: number;
  kind?: "free" | "paid"; // default: free
  mode?: Mode; // required if kind=paid
};

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as GrantBody | null;

  const wallet = String(body?.wallet || "").trim();
  const amount = Math.max(0, Math.floor(Number(body?.amount ?? 0)));
  const kind = body?.kind ?? "free";
  const mode = body?.mode;

  if (!wallet || wallet.length < 8 || amount <= 0) {
    return NextResponse.json(
      { ok: false, error: "BAD_INPUT" },
      { status: 400 },
    );
  }

  if (kind === "paid") {
    if (mode !== "normal" && mode !== "daily" && mode !== "superprize") {
      return NextResponse.json(
        { ok: false, error: "BAD_MODE" },
        { status: 400 },
      );
    }
    grantPaidRun(wallet, mode, amount);
    return NextResponse.json({ ok: true, kind: "paid", mode, amount });
  }

  // free usable in any mode
  grantRuns(wallet, amount);
  return NextResponse.json({ ok: true, kind: "free", amount });
}
