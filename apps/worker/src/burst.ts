import { eq, sql } from "drizzle-orm";
import { subscriptions, type Database } from "@scenestealer/db";

// Decrements a tenant's burst-processing balance by real elapsed job
// time, clamped at 0 — a job that started with a small remaining
// balance isn't charged into negative, it just lands the balance
// exactly on 0. Called from analyze.ts/render.ts once a job actually
// finishes (success or failure — the fast Machine was used either
// way), only when that job's row had burstModeUsed set at dispatch
// time (apps/api's routes/videos.ts, routes/clips.ts). Mirrors
// apps/api/src/billing-tiers.ts's chargeBurstSeconds — duplicated
// rather than shared across the app boundary, since apps/worker and
// apps/api don't share application code, only @scenestealer/db.
export async function chargeBurstSeconds(
  db: Database,
  tenantId: string,
  elapsedSeconds: number,
): Promise<void> {
  await db
    .update(subscriptions)
    .set({
      burstSecondsRemaining: sql`greatest(0, ${subscriptions.burstSecondsRemaining} - ${Math.round(elapsedSeconds)})`,
    })
    .where(eq(subscriptions.tenantId, tenantId));
}
