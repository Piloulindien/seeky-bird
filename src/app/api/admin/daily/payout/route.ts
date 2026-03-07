import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/server/admin";
import {
  getDailyDistributionByDay,
  setDailyDistributionPayoutTxSigs,
} from "@/server/daily";
import { payWinnersOnChain } from "@/server/payouts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
  "Surrogate-Control": "no-store",
};

function bad(msg: string, status = 400) {
  return NextResponse.json(
    { ok: false, error: msg },
    { status, headers: NO_STORE_HEADERS },
  );
}

export async function POST(req: NextRequest) {
  if (!requireAdmin(req)) {
    return bad("UNAUTHORIZED", 401);
  }

  const body = (await req.json().catch(() => null)) as {
    day?: string;
  } | null;

  const day = String(body?.day || "").trim();
  if (!day) {
    return bad("BAD_DAY");
  }

  const dist = getDailyDistributionByDay(day);
  if (!dist) {
    return bad("DAY_DISTRIBUTION_NOT_FOUND", 404);
  }

  if (Array.isArray(dist.payoutTxSigs) && dist.payoutTxSigs.length > 0) {
    return NextResponse.json(
      {
        ok: true,
        day,
        alreadyPaid: true,
        payoutTxSigs: dist.payoutTxSigs,
        payouts: dist.payouts,
      },
      { headers: NO_STORE_HEADERS },
    );
  }

  if (!Array.isArray(dist.payouts) || dist.payouts.length === 0) {
    return bad("NO_PAYOUTS");
  }

  try {
    const sigs = await payWinnersOnChain(
      dist.payouts.map((p) => ({
        wallet: p.wallet,
        amountSol: p.amountSol,
      })),
    );

    const saved = setDailyDistributionPayoutTxSigs(day, sigs);
    if (!saved.ok) {
      return bad(saved.error, 500);
    }

    const updated = getDailyDistributionByDay(day);

    return NextResponse.json(
      {
        ok: true,
        day,
        payoutTxSigs: sigs,
        payouts: updated?.payouts ?? dist.payouts,
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (err) {
    return bad(err instanceof Error ? err.message : "PAYOUT_FAILED", 500);
  }
}
