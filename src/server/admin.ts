// src/server/admin.ts
import { NextRequest } from "next/server";

export function requireAdmin(req: NextRequest) {
  const expected = process.env.SUPERPRIZE_ADMIN_TOKEN || "";
  const got = req.headers.get("x-admin-token") || "";

  if (!expected || got !== expected) {
    return false;
  }
  return true;
}
