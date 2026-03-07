// src/app/api/admin/superprize/finalize/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/server/admin";
import {
  finalizeEvent,
  getEventById,
  setEventPayoutTxSigs,
} from "@/server/superprize";
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

  const res = finalizeEvent();
  if (!res.ok) {
    return bad(res.error);
  }

  const event = getEventById(res.event.id);
  if (!event) {
    return bad("EVENT_NOT_FOUND", 500);
  }

  if (Array.isArray(event.payoutTxSigs) && event.payoutTxSigs.length > 0) {
    return NextResponse.json(
      {
        ok: true,
        event,
        winners: res.winners,
        alreadyPaid: true,
        payoutTxSigs: event.payoutTxSigs,
      },
      { headers: NO_STORE_HEADERS },
    );
  }

  try {
    const sigs = await payWinnersOnChain(
      res.winners.map((w) => ({
        wallet: w.wallet,
        amountSol: w.amountSol,
      })),
    );

    setEventPayoutTxSigs(event.id, sigs);

    const updated = getEventById(event.id);

    return NextResponse.json(
      {
        ok: true,
        event: updated,
        winners: res.winners,
        payoutTxSigs: sigs,
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (err) {
    return bad(err instanceof Error ? err.message : "PAYOUT_FAILED", 500);
  }
}
