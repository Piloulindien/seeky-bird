import { Suspense } from "react";
import LeaderboardClient from "./LeaderboardClient";

export default function Page() {
  return (
    <Suspense fallback={<div style={{ padding: 16 }}>Loading…</div>}>
      <LeaderboardClient />
    </Suspense>
  );
}
