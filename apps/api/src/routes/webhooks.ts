import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { verifyWebhook } from "@clerk/hono/webhooks";
import { createDb, tenants, subscriptions } from "@scenestealer/db";
import { createStripeClient } from "../stripe-client.js";
import {
  getTiers,
  getStorageAddon,
  getBurstAddon,
  type TierSlug,
} from "../billing-tiers.js";
import type { Env } from "../index.js";
import type Stripe from "stripe";

export const webhooks = new Hono<{ Bindings: Env }>();

/**
 * Provisions a `tenants` row the moment a Clerk Organization is created,
 * so a brand-new org's session doesn't 403 in requireTenant (see
 * ../auth.ts) before anyone's had a chance to set anything up manually.
 * `onConflictDoNothing` makes this safe against Svix's at-least-once
 * delivery retrying the same event.
 */
webhooks.post("/clerk", async (c) => {
  let event;
  try {
    event = await verifyWebhook(c, {
      signingSecret: c.env.CLERK_WEBHOOK_SIGNING_SECRET,
    });
  } catch {
    return c.json({ error: "Invalid webhook signature" }, 400);
  }

  if (event.type === "organization.created") {
    const db = createDb(c.env.DATABASE_URL);
    await db
      .insert(tenants)
      .values({ clerkOrgId: event.data.id, name: event.data.name })
      .onConflictDoNothing({ target: tenants.clerkOrgId });
  }

  return c.json({ received: true });
});

// Reads a Stripe subscription's line items and derives { plan,
// storageAddonUnits, currentPeriodEnd } by matching each item's Price
// ID against the static tier/add-on config — shared by
// checkout.session.completed and customer.subscription.updated below
// so tier detection can't drift between the two.
//
// current_period_end lives on each SubscriptionItem, not on the
// Subscription itself, as of this SDK's API version (Stripe moved
// billing-cycle tracking to the item level so a subscription can mix
// items with different cycles) — confirmed against the installed
// stripe package's own types, not assumed. This app only ever puts
// same-interval (monthly) items on one subscription, so the tier
// item's own period end is what matters; falls back to the first item
// if the tier price somehow isn't found.
export function planFromSubscriptionItems(
  env: Env,
  items: Stripe.SubscriptionItem[],
): { plan: TierSlug; storageAddonUnits: number; currentPeriodEnd: Date } {
  const tiers = getTiers(env);
  const addon = getStorageAddon(env);
  let plan: TierSlug = "free";
  let storageAddonUnits = 0;
  let currentPeriodEnd = items[0]
    ? new Date(items[0].current_period_end * 1000)
    : new Date();
  for (const item of items) {
    const priceId = item.price.id;
    if (priceId === addon.stripePriceId) {
      storageAddonUnits = item.quantity ?? 0;
      continue;
    }
    const matched = (Object.values(tiers) as (typeof tiers)[TierSlug][]).find(
      (t) => t.stripePriceId === priceId,
    );
    if (matched) {
      plan = matched.slug;
      currentPeriodEnd = new Date(item.current_period_end * 1000);
    }
  }
  return { plan, storageAddonUnits, currentPeriodEnd };
}

/**
 * Stripe subscription lifecycle — see the billing plan's "Backend"
 * section. Verified with constructEventAsync (not the Node-only
 * constructEvent — Workers has no Node `crypto`), against the raw
 * request body (signature verification needs the exact bytes Stripe
 * signed, not a re-serialized JSON.parse/stringify round-trip).
 */
webhooks.post("/stripe", async (c) => {
  const stripe = createStripeClient(c.env);
  const signature = c.req.header("stripe-signature");
  const payload = await c.req.text();

  let event;
  try {
    if (!signature) throw new Error("missing stripe-signature header");
    event = await stripe.webhooks.constructEventAsync(
      payload,
      signature,
      c.env.STRIPE_WEBHOOK_SECRET,
    );
  } catch {
    return c.json({ error: "Invalid webhook signature" }, 400);
  }

  const db = createDb(c.env.DATABASE_URL);

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const tenantId = session.metadata?.tenantId;
    const customerId = session.customer;
    const customerIdStr =
      typeof customerId === "string" ? customerId : customerId?.id;

    if (tenantId && customerIdStr && session.metadata?.purpose === "burst") {
      // One-time burst-processing pack — credits burstSecondsRemaining
      // rather than touching plan/storageAddonUnits, and works whether
      // or not the tenant has a subscriptions row yet (a Free tenant's
      // first-ever Stripe purchase can be a burst pack).
      const addon = getBurstAddon(c.env);
      await db
        .insert(subscriptions)
        .values({
          tenantId,
          stripeCustomerId: customerIdStr,
          burstSecondsRemaining: addon.packSeconds,
        })
        .onConflictDoUpdate({
          target: subscriptions.tenantId,
          // Never overwrite an existing stripeCustomerId: a burst pack
          // is bought under whatever customer the tenant already has
          // (see POST /checkout/burst), and replacing it here would
          // orphan their real subscription from the Customer Portal.
          set: {
            stripeCustomerId: sql`coalesce(${subscriptions.stripeCustomerId}, ${customerIdStr})`,
            burstSecondsRemaining: sql`${subscriptions.burstSecondsRemaining} + ${addon.packSeconds}`,
          },
        });
      return c.json({ received: true });
    }

    const subscriptionId = session.subscription;
    if (!tenantId || typeof subscriptionId !== "string" || !customerIdStr) {
      // Not one of our subscription or burst Checkout Sessions —
      // nothing for this handler to do.
      return c.json({ received: true });
    }

    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const { plan, storageAddonUnits, currentPeriodEnd } =
      planFromSubscriptionItems(c.env, subscription.items.data);

    await db
      .insert(subscriptions)
      .values({
        tenantId,
        stripeCustomerId: customerIdStr,
        stripeSubscriptionId: subscriptionId,
        plan,
        storageAddonUnits,
        currentPeriodEnd,
      })
      .onConflictDoUpdate({
        target: subscriptions.tenantId,
        set: {
          stripeCustomerId: customerIdStr,
          stripeSubscriptionId: subscriptionId,
          plan,
          storageAddonUnits,
          currentPeriodEnd,
          cancelAtPeriodEnd: false,
        },
      });
  }

  // Status decides whether the paid tier is in effect at all.
  // past_due keeps it (Smart Retries are still trying — a grace
  // period); unpaid/paused/incomplete* mean payment has lapsed, so the
  // tenant drops to Free limits. stripeSubscriptionId is kept in that
  // case: paying the outstanding invoice through the portal flips the
  // status back to active, and this same handler restores the tier.
  if (event.type === "customer.subscription.updated") {
    const subscription = event.data.object;
    const { plan, storageAddonUnits, currentPeriodEnd } =
      planFromSubscriptionItems(c.env, subscription.items.data);
    const inGoodStanding =
      subscription.status === "active" ||
      subscription.status === "trialing" ||
      subscription.status === "past_due";
    await db
      .update(subscriptions)
      .set(
        inGoodStanding
          ? {
              plan,
              storageAddonUnits,
              currentPeriodEnd,
              cancelAtPeriodEnd: subscription.cancel_at_period_end,
            }
          : {
              plan: "free",
              storageAddonUnits: 0,
              currentPeriodEnd,
              cancelAtPeriodEnd: false,
            },
      )
      .where(eq(subscriptions.stripeSubscriptionId, subscription.id));
  }

  // Cancellation drops the tenant back to Free — reset in place rather
  // than deleting the row, so a real stripeCustomerId and any unused
  // burstSecondsRemaining (from separate one-time pack purchases)
  // survive the cancellation. POST /stripe/checkout's "already
  // subscribed" guard keys off stripeSubscriptionId specifically (now
  // null again here), not row existence, so this doesn't block a later
  // resubscribe.
  if (event.type === "customer.subscription.deleted") {
    const subscription = event.data.object;
    await db
      .update(subscriptions)
      .set({
        plan: "free",
        stripeSubscriptionId: null,
        storageAddonUnits: 0,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
      })
      .where(eq(subscriptions.stripeSubscriptionId, subscription.id));
  }

  // Best-effort notification only — payment retry logic itself is
  // Stripe's Smart Retries (already the decided mechanism, per
  // PLAN.md), this just lets the tenant know it's happening. Always
  // sent when an address is on file, independent of
  // notifyOnPublishFailure (a different, narrower toggle for a
  // different kind of failure).
  if (event.type === "invoice.payment_failed") {
    const invoice = event.data.object;
    const customerId =
      typeof invoice.customer === "string"
        ? invoice.customer
        : invoice.customer?.id;
    if (!customerId) return c.json({ received: true });

    const [row] = await db
      .select({ notificationEmail: tenants.notificationEmail })
      .from(subscriptions)
      .innerJoin(tenants, eq(tenants.id, subscriptions.tenantId))
      .where(eq(subscriptions.stripeCustomerId, customerId))
      .limit(1);

    if (row?.notificationEmail && c.env.RESEND_API_KEY) {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${c.env.RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from: "SceneStealer <notifications@scenestealer.app>",
          to: row.notificationEmail,
          subject: "A payment on your SceneStealer account failed",
          html: "<p>We weren't able to charge your card on file. We'll retry automatically — update your payment method from the Account page to avoid any interruption.</p>",
        }),
      }).catch(() => {
        // Best-effort — a failed notification email shouldn't fail the
        // webhook itself (Stripe would just retry the whole event).
      });
    }
  }

  return c.json({ received: true });
});
