// src/app/admin/page.tsx
"use client";

import type React from "react";
import { useMemo, useState } from "react";

type AdminStatusPayload = {
  ok: boolean;
  normal: unknown | null;
  daily: unknown | null;
  superprize: unknown | null;
};

const ADMIN_KEY = "seeky_admin_authed";
const ADMIN_PWD = "seeky_admin_pwd"; // optionnel
const ADMIN_PASSWORD = "change-me"; // TODO: remplace

export default function AdminPage() {
  const [pwd, setPwd] = useState("");
  const [auth, setAuth] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(ADMIN_KEY) === "1";
  });

  const [status, setStatus] = useState<AdminStatusPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const canLogin = useMemo(() => pwd.trim().length > 0, [pwd]);

  async function refresh() {
    // ✅ pas de setState sync dans un effect; ici c'est un handler user / timer
    setLoading(true);
    setErr(null);

    const r = await fetch("/api/admin/status", { cache: "no-store" }).catch(
      () => null,
    );
    if (!r || !r.ok) {
      setStatus(null);
      setErr("Failed to load admin status.");
      setLoading(false);
      return;
    }

    const j = (await r.json().catch(() => null)) as AdminStatusPayload | null;
    if (!j || typeof j !== "object" || j.ok !== true) {
      setStatus(null);
      setErr("Bad response.");
      setLoading(false);
      return;
    }

    setStatus(j);
    setLoading(false);
  }

  if (!auth) {
    return (
      <main style={wrap}>
        <div style={card}>
          <div style={{ fontWeight: 900, fontSize: 18 }}>Admin</div>
          <div style={{ opacity: 0.8, fontSize: 13 }}>
            Enter password to access.
          </div>

          <input
            value={pwd}
            onChange={(e) => setPwd(e.target.value)}
            placeholder="Password"
            type="password"
            style={input}
          />

          <button
            style={{ ...btn, opacity: canLogin ? 1 : 0.6 }}
            disabled={!canLogin}
            onClick={() => {
              if (pwd !== ADMIN_PASSWORD) {
                setErr("Wrong password.");
                return;
              }

              if (typeof window !== "undefined") {
                localStorage.setItem(ADMIN_KEY, "1");
                localStorage.setItem(ADMIN_PWD, pwd);
              }

              setAuth(true);
              setErr(null);

              // ✅ refresh après login sans useEffect (pour éviter ta règle eslint)
              window.setTimeout(() => void refresh(), 0);
            }}
          >
            Login
          </button>

          {err && <div style={{ color: "#fca5a5", fontSize: 13 }}>{err}</div>}
        </div>
      </main>
    );
  }

  return (
    <main style={wrap}>
      <div style={card}>
        <div
          style={{ display: "flex", justifyContent: "space-between", gap: 8 }}
        >
          <div>
            <div style={{ fontWeight: 900, fontSize: 18 }}>Admin</div>
            <div style={{ opacity: 0.75, fontSize: 13 }}>
              Status aggregation (normal / daily / superprize)
            </div>
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button style={btn} onClick={() => void refresh()}>
              Refresh
            </button>
            <button
              style={{ ...btn, opacity: 0.85 }}
              onClick={() => {
                if (typeof window !== "undefined") {
                  localStorage.removeItem(ADMIN_KEY);
                }
                setAuth(false);
                setStatus(null);
                setErr(null);
              }}
            >
              Logout
            </button>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            style={{ ...btn, opacity: 0.9 }}
            onClick={() => window.setTimeout(() => void refresh(), 0)}
          >
            Load status
          </button>
        </div>

        {loading && <div style={{ opacity: 0.8 }}>Loading…</div>}
        {err && <div style={{ color: "#fca5a5", fontSize: 13 }}>{err}</div>}

        <pre style={pre}>{JSON.stringify(status, null, 2)}</pre>
      </div>
    </main>
  );
}

const wrap: React.CSSProperties = {
  minHeight: "100vh",
  background: "#020617",
  color: "white",
  padding: 16,
  fontFamily: "system-ui",
};

const card: React.CSSProperties = {
  width: "min(720px, 100%)",
  margin: "0 auto",
  padding: 16,
  borderRadius: 16,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(255,255,255,0.04)",
  display: "flex",
  flexDirection: "column",
  gap: 12,
};

const input: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.2)",
  background: "rgba(255,255,255,0.06)",
  color: "white",
  outline: "none",
};

const btn: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.2)",
  background: "rgba(255,255,255,0.14)",
  color: "white",
  cursor: "pointer",
  fontWeight: 800,
};

const pre: React.CSSProperties = {
  marginTop: 8,
  padding: 12,
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(0,0,0,0.25)",
  overflow: "auto",
  fontSize: 12,
  lineHeight: 1.3,
};
