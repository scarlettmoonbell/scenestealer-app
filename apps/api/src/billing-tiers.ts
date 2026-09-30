import { eq, sql } from "drizzle-orm";
import {
  subscriptions,
  sourceVideos,
  clips,
  type Database,
} from "@scenestealer/db";
import type { Env } from "./index.js";

// Tier definitions for the storage-gated billing model — see the
// billing plan's "Proposed tier structure" and "Tier-based compute"
// sections. Deliberately "quantum" tiering, not feature-gated: every
// tier gets the exact same feature set, only the storage cap and the
// spawned Fly Machine's size change. Storage caps and Machine sizes
// are static config (safe to tune later); Stripe Price IDs vary by
// environment (test-mode on dev, live on prod) and Stripe account
// migration history, so those come from env/secrets instead of being
// hardcoded here.

const GB = 1024 * 1024 * 1024;

// "tester" — added 2026-09-17: a secret, unbilled tier with Medium's
// limits, for internal/invited testers. Not billed (no Stripe Price,
// no stripeCustomerId required), not shown anywhere in apps/web's tier
// picker (deliberately excluded from account/page.tsx's TIER_CARDS),
// and only assignable via the admin interface (POST/DELETE
// /admin/tenants/:id/tester, requireAdmin-gated) — never self-serve,
// never reachable through /stripe/checkout (that route only accepts
// tiers with a real stripePriceId, which this one doesn't have).
export type TierSlug = "free" | "small" | "medium" | "large" | "tester";

export interface MachineGuest {
  cpu_kind: "performance";
  cpus: number;
  memory_mb: number;
}

export interface TierConfig {
  slug: TierSlug;
  name: string;
  storageCapBytes: number;
  // Null for tiers with no Stripe Price — Free (the no-subscription
  // state) and the secret unbilled tester tier.
  stripePriceId: string | null;
  machineGuest: MachineGuest;
}

// Baseline machine size — unchanged from what every job already ran
// on before tier-based sizing existed (apps/api/src/fly-machines.ts).
const BASELINE_GUEST: MachineGuest = {
  cpu_kind: "performance",
  cpus: 2,
  memory_mb: 4096,
};

const MEDIUM_GUEST: MachineGuest = {
  cpu_kind: "performance",
  cpus: 4,
  memory_mb: 8192,
};

// Also used as the burst-processing guest (see resolveDispatchGuest
// below) — burst grants temporary access to this same machine size
// regardless of tier.
const LARGE_GUEST: MachineGuest = {
  cpu_kind: "performance",
  cpus: 8,
  memory_mb: 16384,
};

export function getTiers(env: Env): Record<TierSlug, TierConfig> {
  return {
    free: {
      slug: "free",
      name: "Free",
      storageCapBytes: 4 * GB,
      stripePriceId: null,
      machineGuest: BASELINE_GUEST,
    },
    small: {
      slug: "small",
      name: "Small",
      storageCapBytes: 25 * GB,
      stripePriceId: env.STRIPE_PRICE_SMALL,
      machineGuest: BASELINE_GUEST,
    },
    medium: {
      slug: "medium",
      name: "Medium",
      storageCapBytes: 100 * GB,
      stripePriceId: env.STRIPE_PRICE_MEDIUM,
      machineGuest: MEDIUM_GUEST,
    },
    large: {
      slug: "large",
      name: "Large",
      storageCapBytes: 300 * GB,
      stripePriceId: env.STRIPE_PRICE_LARGE,
      machineGuest: LARGE_GUEST,
    },
    tester: {
      slug: "tester",
      name: "Tester",
      storageCapBytes: 100 * GB, // same limits as Medium
      stripePriceId: null,
      machineGuest: MEDIUM_GUEST,
    },
  };
}

// A recurring (not one-time) subscription-item Price — quantity is the
// number of 200GB blocks, adjustable by the tenant directly through
// the Stripe Customer Portal, so there's no custom "buy storage" flow
// to build. See the billing plan's cost-basis note for why $12/mo per
// block is a healthy markup over R2's raw $0.015/GB-month.
export function getStorageAddon(env: Env): {
  blockSizeBytes: number;
  stripePriceId: string;
} {
  return {
    blockSizeBytes: 200 * GB,
    stripePriceId: env.STRIPE_PRICE_STORAGE_ADDON,
  };
}

// One-time (not recurring) purchase — 2 hours of guaranteed
// performance-8x (Large-tier) processing, usable regardless of the
// tenant's actual tier. Metered by real elapsed job time (workers
// decrement subscriptions.burstSecondsRemaining themselves — see
// apps/worker/src/analyze.ts and render.ts), not a flat per-job
// estimate. $4.99 for 2h of performance-8x (~$0.3577/hr, confirmed
// live against Fly's current pricing) costs ~$0.72 raw — a ~6.9x
// markup, appropriate for a convenience/speed product rather than a
// resold commodity like storage.
export function getBurstAddon(env: Env): {
  packSeconds: number;
  stripePriceId: string;
} {
  return {
    packSeconds: 2 * 60 * 60,
    stripePriceId: env.STRIPE_PRICE_BURST,
  };
}

export function tierSlugOrFree(plan: string | undefined): TierSlug {
  return plan === "small" ||
    plan === "medium" ||
    plan === "large" ||
    plan === "tester"
    ? plan
    : "free";
}

// Total bytes a tenant may store right now: their tier's included
// cap plus however many storage add-on blocks are active. Used by
// both GET /tenant/usage and the upload-time quota check (uploads.ts)
// so the two never drift apart.
export function getCapBytes(
  env: Env,
  plan: string | undefined,
  storageAddonUnits: number,
): number {
  const tier = getTiers(env)[tierSlugOrFree(plan)];
  const addon = getStorageAddon(env);
  return tier.storageCapBytes + storageAddonUnits * addon.blockSizeBytes;
}

// Picks the Fly Machine size for a tenant's next analyze/render job,
// and reports whether burst was used so the caller can record it on
// the sourceVideo/clip row (see videos.ts's runAnalyzeJob and
// clips.ts's render route) — that flag is what tells the worker,
// later, whether to decrement burstSecondsRemaining once the job
// actually finishes and its real elapsed time is known. A tenant with
// any positive burst balance gets the burst guest for their next job,
// even if the balance is small; the final job's real elapsed seconds
// can run the balance to (but never below) zero.
export async function resolveDispatchGuest(
  db: Database,
  env: Env,
  tenantId: string,
): Promise<{ guest: MachineGuest; burstUsed: boolean }> {
  const [sub] = await db
    .select({
      plan: subscriptions.plan,
      burstSecondsRemaining: subscriptions.burstSecondsRemaining,
    })
    .from(subscriptions)
    .where(eq(subscriptions.tenantId, tenantId))
    .limit(1);

  if ((sub?.burstSecondsRemaining ?? 0) > 0) {
    return { guest: LARGE_GUEST, burstUsed: true };
  }
  return {
    guest: getTiers(env)[tierSlugOrFree(sub?.plan)].machineGuest,
    burstUsed: false,
  };
}

// A tenant's current subscription row, normalized for a tenant that
// has never subscribed (Free, no add-on units, no row at all yet).
export async function getTenantPlan(
  db: Database,
  tenantId: string,
): Promise<{
  plan: TierSlug;
  storageAddonUnits: number;
  burstSecondsRemaining: number;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}> {
  const [sub] = await db
    .select({
      plan: subscriptions.plan,
      storageAddonUnits: subscriptions.storageAddonUnits,
      burstSecondsRemaining: subscriptions.burstSecondsRemaining,
      currentPeriodEnd: subscriptions.currentPeriodEnd,
      cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
    })
    .from(subscriptions)
    .where(eq(subscriptions.tenantId, tenantId))
    .limit(1);
  return {
    plan: tierSlugOrFree(sub?.plan),
    storageAddonUnits: sub?.storageAddonUnits ?? 0,
    burstSecondsRemaining: sub?.burstSecondsRemaining ?? 0,
    currentPeriodEnd: sub?.currentPeriodEnd ?? null,
    cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false,
  };
}

// Live total of bytes this tenant currently has stored in R2 — source
// videos plus rendered clips. Not period-scoped: storage persists
// until deleted, unlike a monthly processing-volume count would be.
export async function getUsedBytes(
  db: Database,
  tenantId: string,
): Promise<number> {
  const [{ total: sourceBytes }] = await db
    .select({
      total: sql<string>`coalesce(sum(${sourceVideos.fileSizeBytes}), 0)`,
    })
    .from(sourceVideos)
    .where(eq(sourceVideos.tenantId, tenantId));

  const [{ total: clipBytes }] = await db
    .select({
      total: sql<string>`coalesce(sum(${clips.fileSizeBytes}), 0)`,
    })
    .from(clips)
    .where(eq(clips.tenantId, tenantId));

  return Number(sourceBytes) + Number(clipBytes);
}

// Decrements a tenant's burst balance by real elapsed job time,
// clamped at 0 (a job that started with a small remaining balance
// isn't charged into negative — the balance just hits exactly 0).
// Called directly by the workers (apps/worker/src/analyze.ts,
// render.ts), which already have their own DATABASE_URL and know
// their own precise elapsed time — no HTTP round-trip through apps/api
// needed for this.
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
