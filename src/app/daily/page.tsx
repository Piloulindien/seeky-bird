import { Suspense } from "react";
import DailyClient from "./DailyClient";

export default function Page() {
  return (
    <Suspense
      fallback={<div style={{ padding: 16, color: "white" }}>Loading…</div>}
    >
      <DailyClient />
    </Suspense>
  );
}
