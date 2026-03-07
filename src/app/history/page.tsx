import { Suspense } from "react";
import HistoryClient from "./HistoryClient";

export default function Page() {
  return (
    <Suspense
      fallback={<div style={{ padding: 16, color: "white" }}>Loading…</div>}
    >
      <HistoryClient />
    </Suspense>
  );
}
