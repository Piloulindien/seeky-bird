// src/lib/tx.ts
"use client";

const TX_REGISTRY_KEY = "seeky_tx_registry_v1";

export type TxKind =
  | "normal_round_payout"
  | "daily_payout"
  | "superprize_payout";

export type TxRecord = {
  kind: TxKind;
  ref: string; // ex: roundId "12", daily "2026-02-13", superprize eventId
  sigs: string[]; // une ou plusieurs signatures (multi-tx possible)
  updatedAt: number;
};

function readAll(): TxRecord[] {
  if (typeof window === "undefined") return [];
  const raw = localStorage.getItem(TX_REGISTRY_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as TxRecord[]) : [];
  } catch {
    return [];
  }
}

function writeAll(list: TxRecord[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(TX_REGISTRY_KEY, JSON.stringify(list));
  window.dispatchEvent(new Event("seeky:update"));
}

export function getTxSigs(kind: TxKind, ref: string): string[] {
  const all = readAll();
  const hit = all.find((x) => x.kind === kind && x.ref === ref);
  return hit?.sigs ?? [];
}

export function setTxSigs(kind: TxKind, ref: string, sigs: string[]) {
  const clean = sigs.map((s) => String(s || "").trim()).filter(Boolean);
  const all = readAll();
  const next: TxRecord = { kind, ref, sigs: clean, updatedAt: Date.now() };
  const filtered = all.filter((x) => !(x.kind === kind && x.ref === ref));
  writeAll([next, ...filtered].slice(0, 500));
}
