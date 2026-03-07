import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/server/admin";
import {
  getNormalDistributionByRound,
  setNormalDistributionPayoutTxSigs,
} from "@/server/normalCore";
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
    roundId?: number;
  } | null;

  const roundId = Math.floor(Number(body?.roundId || 0));
  if (!roundId) {
    return bad("BAD_ROUND_ID");
  }

  const dist = getNormalDistributionByRound(roundId);
  if (!dist) {
    return bad("ROUND_DISTRIBUTION_NOT_FOUND", 404);
  }

  if (Array.isArray(dist.payoutTxSigs) && dist.payoutTxSigs.length > 0) {
    return NextResponse.json(
      {
        ok: true,
        roundId,
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

    const saved = setNormalDistributionPayoutTxSigs(roundId, sigs);
    if (!saved.ok) {
      return bad(saved.error, 500);
    }

    const updated = getNormalDistributionByRound(roundId);

    return NextResponse.json(
      {
        ok: true,
        roundId,
        payoutTxSigs: sigs,
        payouts: updated?.payouts ?? dist.payouts,
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (err) {
    return bad(err instanceof Error ? err.message : "PAYOUT_FAILED", 500);
  }
}
