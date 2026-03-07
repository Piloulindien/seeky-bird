"use client";

import Link from "next/link";
import type React from "react";
import { ECONOMY } from "../../lib/economy";

type Item = {
  title: string;
  body: React.ReactNode;
};

function isNumberArray(x: unknown): x is number[] {
  return (
    Array.isArray(x) &&
    x.every((v) => typeof v === "number" && Number.isFinite(v))
  );
}

function formatPct(x: number): string {
  return `${Math.round(x * 1000) / 10}%`;
}

function normalizeSplit(split: number[], maxLen: number): number[] {
  const cleaned = split
    .map((v) => (Number.isFinite(v) && v > 0 ? v : 0))
    .slice(0, maxLen);

  const sum = cleaned.reduce((a, b) => a + b, 0);
  if (sum <= 0) return [];
  return cleaned.map((v) => v / sum);
}

function getNormalTop10Split(): number[] {
  const split = (ECONOMY as unknown as Record<string, unknown>)
    .payoutSplitsTop10;
  if (!isNumberArray(split)) return [];
  return normalizeSplit(split, 10);
}

function CompactSplitLine({ split, max }: { split: number[]; max: number }) {
  if (!split.length) return <div style={hint}>Distribution unavailable.</div>;

  const parts = split.slice(0, max).map((p, i) => `#${i + 1} ${formatPct(p)}`);
  return (
    <div style={compactBox}>
      <div style={{ fontWeight: 900, marginBottom: 6 }}>Distribution</div>
      <div style={compactText}>{parts.join(" · ")}</div>
    </div>
  );
}

function CompactSplitList({ split, max }: { split: number[]; max: number }) {
  if (!split.length) return <div style={hint}>Distribution unavailable.</div>;

  return (
    <div style={splitList}>
      {split.slice(0, max).map((p, i) => (
        <div key={i} style={row}>
          <span style={rowMain}>
            #{i + 1} <b>{formatPct(p)}</b>
          </span>
          <span style={mutedRight}>of the pool</span>
        </div>
      ))}
    </div>
  );
}

export default function RewardsPage() {
  const normalSplit = getNormalTop10Split();

  const dailySplit = normalizeSplit([0.5, 0.3, 0.2], 3);
  const superPrizeSplit = normalizeSplit([0.5, 0.3, 0.2], 3);

  const items: Item[] = [
    {
      title: "Normal Mode (Top 10 payout)",
      body: (
        <>
          <p style={p}>
            Top 10 players share the pool when the threshold is reached.
          </p>

          <ul style={ul}>
            <li>Entry: {ECONOMY.entrySol.toFixed(2)} SOL</li>
            <li>
              Payout trigger: pool reaches {ECONOMY.thresholdSol.toFixed(2)} SOL
            </li>
            <li>Max paid positions per wallet: 3</li>
            <li>New round starts immediately after payout</li>
          </ul>

          <div style={sectionTitle}>Distribution (Top 10)</div>
          <CompactSplitLine split={normalSplit} max={10} />
        </>
      ),
    },
    {
      title: "Daily Tournament (Top 3 payout)",
      body: (
        <>
          <p style={p}>Top 3 players share the daily pool.</p>

          <ul style={ul}>
            <li>Resets daily at 00:00 UTC</li>
            <li>Max paid positions per wallet: 1</li>
          </ul>

          <div style={sectionTitle}>Distribution (Top 3)</div>
          <CompactSplitList split={dailySplit} max={3} />
        </>
      ),
    },
    {
      title: "SuperPrize (Top 3 payout)",
      body: (
        <>
          <ul style={ul}>
            <li>Max paid positions per wallet: 1</li>
          </ul>

          <div style={sectionTitle}>Distribution (Top 3)</div>
          <CompactSplitList split={superPrizeSplit} max={3} />
        </>
      ),
    },
    {
      title: "Free Runs & Spin",
      body: (
        <ul style={ul}>
          <li>1 guaranteed free run per day (UTC)</li>
          <li>1 daily spin (wins 1–5 extra runs)</li>
          <li>Maximum 6 free runs per day</li>
          <li>Unused free runs expire at 00:00 UTC</li>
        </ul>
      ),
    },
    {
      title: "Payout transactions",
      body: (
        <ul style={ul}>
          <li>Every payout stores one or more transaction signatures</li>
          <li>
            History shows a <b>View</b> button for each payout transaction
          </li>
          <li>View opens Solscan for the transaction</li>
        </ul>
      ),
    },
  ];

  return (
    <main style={wrap}>
      <div style={shell}>
        <header style={topBar}>
          <Link href="/" style={homeBtn}>
            ⬅ Home
          </Link>

          <div style={titleWrap}>
            <div style={title}>Rewards</div>
            <div style={subtitle}>Payout logic summary</div>
          </div>
        </header>

        <div style={stack}>
          {items.map((it) => (
            <Accordion key={it.title} title={it.title}>
              {it.body}
            </Accordion>
          ))}
        </div>

        <footer style={footer}>
          <Link href="/" style={footerBtn}>
            Back to Home
          </Link>
        </footer>
      </div>
    </main>
  );
}

function Accordion({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <details style={card}>
      <summary style={summary}>
        <span style={summaryTitle}>{title}</span>
        <span style={chev} aria-hidden>
          ▾
        </span>
      </summary>
      <div style={content}>{children}</div>
    </details>
  );
}

/* ======================
   Styles
====================== */

const wrap: React.CSSProperties = {
  minHeight: "100vh",
  background: "#020617",
  color: "white",
  padding: 14,
  fontFamily: "system-ui",
  overflowX: "hidden",
};

const shell: React.CSSProperties = {
  width: "min(560px, 100%)",
  margin: "0 auto",
};

const topBar: React.CSSProperties = {
  display: "flex",
  gap: 10,
  alignItems: "center",
  marginBottom: 12,
  flexWrap: "wrap",
};

const titleWrap: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 2,
  minWidth: 0,
  flex: "1 1 220px",
};

const title: React.CSSProperties = {
  fontSize: 20,
  fontWeight: 900,
  lineHeight: 1.1,
};

const subtitle: React.CSSProperties = {
  fontSize: 12,
  opacity: 0.75,
  lineHeight: 1.35,
  overflowWrap: "anywhere",
};

const homeBtn: React.CSSProperties = {
  display: "inline-block",
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.18)",
  background: "rgba(255,255,255,0.06)",
  color: "white",
  textDecoration: "none",
  fontWeight: 800,
  whiteSpace: "nowrap",
};

const stack: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

const card: React.CSSProperties = {
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(255,255,255,0.06)",
  overflow: "hidden",
};

const summary: React.CSSProperties = {
  listStyle: "none",
  cursor: "pointer",
  padding: "14px 12px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  userSelect: "none",
  minHeight: 50,
};

const summaryTitle: React.CSSProperties = {
  fontWeight: 900,
  fontSize: 14,
  minWidth: 0,
  flex: 1,
  overflowWrap: "anywhere",
  lineHeight: 1.3,
};

const chev: React.CSSProperties = {
  opacity: 0.8,
  fontWeight: 900,
  flexShrink: 0,
};

const content: React.CSSProperties = {
  padding: "0 12px 12px 12px",
  fontSize: 13,
  opacity: 0.92,
  overflowWrap: "anywhere",
};

const p: React.CSSProperties = {
  margin: "8px 0 0 0",
  opacity: 0.92,
  lineHeight: 1.4,
  overflowWrap: "anywhere",
};

const ul: React.CSSProperties = {
  margin: "8px 0 0 18px",
  padding: 0,
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const splitList: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const row: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 10,
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(255,255,255,0.03)",
};

const rowMain: React.CSSProperties = {
  minWidth: 0,
  overflowWrap: "anywhere",
};

const mutedRight: React.CSSProperties = {
  opacity: 0.7,
  fontSize: 12,
  flexShrink: 0,
  textAlign: "right",
};

const sectionTitle: React.CSSProperties = {
  marginTop: 12,
  fontWeight: 900,
  opacity: 0.95,
};

const compactBox: React.CSSProperties = {
  marginTop: 10,
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(255,255,255,0.03)",
};

const compactText: React.CSSProperties = {
  lineHeight: 1.4,
  opacity: 0.92,
  fontSize: 12.5,
  wordBreak: "break-word",
};

const hint: React.CSSProperties = {
  marginTop: 10,
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(255,255,255,0.03)",
  opacity: 0.85,
  lineHeight: 1.35,
  fontSize: 12.5,
};

const footer: React.CSSProperties = {
  marginTop: 14,
  opacity: 0.9,
};

const footerBtn: React.CSSProperties = {
  display: "block",
  textAlign: "center",
  padding: "12px 12px",
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.18)",
  background: "rgba(255,255,255,0.06)",
  color: "white",
  textDecoration: "none",
  fontWeight: 900,
};
