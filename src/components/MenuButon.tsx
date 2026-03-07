// src/components/MenuButon.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type MenuItem = { href: string; label: string };

export default function MenuButton({
  items,
  position = "left",
}: {
  items?: MenuItem[];
  position?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);

  const list: MenuItem[] = items ?? [
    { href: "/", label: "🏠 Home" },
    { href: "/play?mode=training", label: "🎯 Training" },
    { href: "/leaderboard", label: "🏆 Leaderboard" },
    { href: "/rewards", label: "💰 Rewards" },
    { href: "/rules", label: "📜 Rules" },
    { href: "/history", label: "🕘 History" },
  ];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <button
        type="button"
        aria-label="Menu"
        onClick={() => setOpen(true)}
        style={{
          position: "fixed",
          top: 12,
          [position]: 12,
          zIndex: 10000,
          width: 44,
          height: 44,
          borderRadius: 14,
          border: "1px solid rgba(255,255,255,0.18)",
          background: "rgba(11,18,32,0.75)",
          color: "white",
          fontSize: 20,
          display: "grid",
          placeItems: "center",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          cursor: "pointer",
        }}
      >
        ☰
      </button>

      {open && (
        <div
          role="presentation"
          onClick={() => setOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 10001,
            background: "rgba(0,0,0,0.55)",
            display: "flex",
            justifyContent: "center",
            alignItems: "flex-end",
            padding: 14,
          }}
        >
          <div
            role="presentation"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(520px, 100%)",
              borderRadius: 18,
              border: "1px solid rgba(255,255,255,0.15)",
              background: "#0b1220",
              color: "white",
              padding: 14,
              boxShadow: "0 10px 40px rgba(0,0,0,0.45)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 10,
              }}
            >
              <div style={{ fontWeight: 900, fontSize: 16 }}>Menu</div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                style={{
                  padding: "8px 10px",
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.16)",
                  background: "rgba(255,255,255,0.06)",
                  color: "white",
                  cursor: "pointer",
                  fontWeight: 800,
                }}
              >
                Close
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {list.map((it) => (
                <Link
                  key={`${it.href}-${it.label}`}
                  href={it.href}
                  onClick={() => setOpen(false)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "12px 12px",
                    borderRadius: 14,
                    border: "1px solid rgba(255,255,255,0.10)",
                    background: "rgba(255,255,255,0.05)",
                    color: "white",
                    textDecoration: "none",
                    fontWeight: 750,
                  }}
                >
                  <span>{it.label}</span>
                  <span style={{ opacity: 0.6 }}>›</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
