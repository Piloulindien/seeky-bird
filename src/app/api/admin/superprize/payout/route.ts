import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/server/admin";
import {
  getEventById,
  getLeaderboard,
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

  const body = (await req.json().catch(() => null)) as {
    eventId?: string;
  } | null;

  const eventId = String(body?.eventId || "").trim();
  if (!eventId) {
    return bad("BAD_EVENT_ID");
  }

  const event = getEventById(eventId);
  if (!event) {
    return bad("EVENT_NOT_FOUND", 404);
  }

  if (event.status !== "settled") {
    return bad("EVENT_NOT_SETTLED");
  }

  if (Array.isArray(event.payoutTxSigs) && event.payoutTxSigs.length > 0) {
    return NextResponse.json(
      {
        ok: true,
        event,
        alreadyPaid: true,
        payoutTxSigs: event.payoutTxSigs,
      },
      { headers: NO_STORE_HEADERS },
    );
  }

  const { winners } = getLeaderboard(eventId);
  if (!Array.isArray(winners) || winners.length === 0) {
    return bad("NO_WINNERS");
  }

  try {
    const sigs = await payWinnersOnChain(
      winners.map((w) => ({
        wallet: w.wallet,
        amountSol: w.amountSol,
      })),
    );

    setEventPayoutTxSigs(eventId, sigs);

    const updated = getEventById(eventId);

    return NextResponse.json(
      {
        ok: true,
        event: updated,
        winners,
        payoutTxSigs: sigs,
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (err) {
    return bad(err instanceof Error ? err.message : "PAYOUT_FAILED", 500);
  }
}
