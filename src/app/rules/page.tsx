"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type React from "react";

type AccordionItem = {
  id: string;
  title: string;
  body: React.ReactNode;
};

export default function RulesPage() {
  const items = useMemo<AccordionItem[]>(
    () => [
      {
        id: "identity",
        title: "Identity",
        body: (
          <ul style={ul}>
            <li>1 wallet = 1 account</li>
            <li>1 wallet = 1 username</li>
            <li>Usernames are permanently linked to the wallet</li>
          </ul>
        ),
      },
      {
        id: "normal",
        title: "Normal Mode",
        body: (
          <ul style={ul}>
            <li>Top 10 leaderboard</li>
            <li>Maximum 3 paid positions per wallet</li>
            <li>Payout triggers when the pool threshold is reached</li>
            <li>A new round starts immediately after payout</li>
          </ul>
        ),
      },
      {
        id: "daily",
        title: "Daily Tournament",
        body: (
          <ul style={ul}>
            <li>Resets every day at 00:00 UTC</li>
            <li>Top 3 leaderboard</li>
            <li>Maximum 1 paid position per wallet</li>
          </ul>
        ),
      },
      {
        id: "superprize",
        title: "SuperPrize Event",
        body: (
          <ul style={ul}>
            <li>Limited-time event</li>
            <li>Top 3 leaderboard</li>
            <li>Maximum 1 paid position per wallet</li>
            <li>3-minute grace period after event end</li>
          </ul>
        ),
      },
      {
        id: "ties",
        title: "Tie-break rule",
        body: (
          <ul style={ul}>
            <li>Higher score ranks first</li>
            <li>If scores are equal: earlier submission ranks higher</li>
          </ul>
        ),
      },
      {
        id: "freeruns",
        title: "Free runs & spin",
        body: (
          <ul style={ul}>
            <li>1 guaranteed free run per day (UTC)</li>
            <li>1 daily spin: 1–5 extra runs</li>
            <li>Maximum 6 free runs per day</li>
            <li>Unused free runs expire at 00:00 UTC</li>
          </ul>
        ),
      },
      {
        id: "transparency",
        title: "Payout transparency",
        body: (
          <ul style={ul}>
            <li>All payouts display transaction signatures</li>
            <li>Each payout includes a View button linking to Solscan</li>
          </ul>
        ),
      },
    ],
    [],
  );

  return (
    <main style={wrap}>
      <div style={shell}>
        <header style={topbar}>
          <Link href="/" style={topBtn}>
            Home
          </Link>
          <div style={topTitle}>Rules</div>
          <div style={topSpacer} />
        </header>

        <div style={content}>
          <h1 style={h1}>Official Rules</h1>
          <p style={sub}>Readable, mobile-first. Tap a section to expand.</p>

          <Accordion items={items} />
        </div>
      </div>
    </main>
  );
}

function Accordion({ items }: { items: AccordionItem[] }) {
  const [openId, setOpenId] = useState<string>(items[0]?.id ?? "");

  return (
    <div style={accordionWrap}>
      {items.map((it) => {
        const open = it.id === openId;
        return (
          <div key={it.id} style={card}>
            <button
              type="button"
              style={cardBtn}
              onClick={() => setOpenId(open ? "" : it.id)}
              aria-expanded={open}
              aria-controls={`panel-${it.id}`}
            >
              <span style={cardTitle}>{it.title}</span>
              <span style={chev}>{open ? "−" : "+"}</span>
            </button>

            {open && (
              <div id={`panel-${it.id}`} style={cardBody}>
                {it.body}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* styles */

const wrap: React.CSSProperties = {
  minHeight: "100vh",
  background: "#020617",
  color: "white",
  padding: 12,
  fontFamily: "system-ui",
  overflowX: "hidden",
};

const shell: React.CSSProperties = {
  width: "min(520px, 100%)",
  margin: "0 auto",
};

const topbar: React.CSSProperties = {
  position: "sticky",
  top: 0,
  zIndex: 20,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  padding: "10px",
  borderRadius: 16,
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(2,6,23,0.92)",
  backdropFilter: "blur(8px)",
};

const topBtn: React.CSSProperties = {
  minWidth: 60,
  textAlign: "center",
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.16)",
  background: "rgba(255,255,255,0.06)",
  color: "white",
  textDecoration: "none",
  fontWeight: 800,
  fontSize: 12,
  whiteSpace: "nowrap",
};

const topTitle: React.CSSProperties = {
  fontWeight: 900,
  fontSize: 14,
  opacity: 0.95,
  textAlign: "center",
  minWidth: 0,
  flex: 1,
};

const topSpacer: React.CSSProperties = {
  minWidth: 60,
};

const content: React.CSSProperties = {
  padding: "12px 4px 4px",
};

const h1: React.CSSProperties = {
  fontSize: 22,
  margin: "12px 0 6px",
  fontWeight: 900,
  lineHeight: 1.1,
};

const sub: React.CSSProperties = {
  margin: "0 0 14px",
  fontSize: 13,
  opacity: 0.8,
  lineHeight: 1.4,
  overflowWrap: "anywhere",
};

const accordionWrap: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

const card: React.CSSProperties = {
  borderRadius: 16,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(255,255,255,0.06)",
  overflow: "hidden",
};

const cardBtn: React.CSSProperties = {
  width: "100%",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 10,
  padding: "14px 12px",
  border: "none",
  background: "transparent",
  color: "white",
  cursor: "pointer",
  minHeight: 50,
};

const cardTitle: React.CSSProperties = {
  fontWeight: 900,
  fontSize: 14,
  textAlign: "left",
  minWidth: 0,
  flex: 1,
  overflowWrap: "anywhere",
  lineHeight: 1.3,
};

const chev: React.CSSProperties = {
  fontWeight: 900,
  fontSize: 18,
  opacity: 0.85,
  width: 24,
  textAlign: "center",
  flexShrink: 0,
};

const cardBody: React.CSSProperties = {
  padding: "0 12px 12px",
  fontSize: 13,
  opacity: 0.92,
  lineHeight: 1.5,
  overflowWrap: "anywhere",
};

const ul: React.CSSProperties = {
  margin: "8px 0 0",
  paddingLeft: 18,
  display: "flex",
  flexDirection: "column",
  gap: 6,
};
