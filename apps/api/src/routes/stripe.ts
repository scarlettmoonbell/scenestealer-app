import { eq } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { createDb, subscriptions } from "@scenestealer/db";
import { requireTenant } from "../auth.js";
import { createStripeClient } from "../stripe-client.js";
import {
  getTiers,
  getStorageAddon,
  getBurstAddon,
  getCapBytes,
  getUsedBytes,
  type TierSlug,
} from "../billing-tiers.js";
import { planFromSubscriptionItems } from "./webhooks.js";
import type { Env } from "../index.js";
import type { Variables } from "../auth.js";

export const stripeRoute = new Hono<{ Bindings: Env; Variables: Variables }>();

stripeRoute.use("*", requireTenant);

// New subscriptions only — for a tenant with no *active recurring*
// subscription yet (the Free tier's normal starting state, whether or
// not they've ever bought a one-time burst pack — see POST
// /checkout/burst below, which doesn't count as "subscribed"). Once
// subscribed, every change (tier switch, storage add-on quantity,
// cancellation) goes through the Customer Portal below instead:
// Stripe's own guidance is that Checkout is for starting a
// subscription, not modifying one, and the Portal already gives
// tenants self-serve tier switching + add-on quantity updates for
// free (see scenestealer-infra's stripe_billing_portal_configuration).
stripeRoute.post("/checkout", async (c) => {
  const tenantId = c.get("tenantId");
  const body = await c.req.json<{
    tier?: string;
    storageAddonUnits?: number;
  }>();

  const tiers = getTiers(c.env);
  const tier = tiers[body.tier as TierSlug];
  if (!tier || !tier.stripePriceId) {
    return c.json({ error: "tier must be one of small, medium, large" }, 400);
  }

  const db = createDb(c.env.DATABASE_URL);
  const [existing] = await db
    .select({ stripeSubscriptionId: subscriptions.stripeSubscriptionId })
    .from(subscriptions)
    .where(eq(subscriptions.tenantId, tenantId))
    .limit(1);
  if (existing?.stripeSubscriptionId) {
    return c.json(
      {
        error: "Already subscribed — manage your plan from the billing portal",
      },
      409,
    );
  }

  const addonUnits = body.storageAddonUnits ?? 0;
  const addon = getStorageAddon(c.env);
  const lineItems = [{ price: tier.stripePriceId, quantity: 1 }];
  if (addonUnits > 0) {
    lineItems.push({ price: addon.stripePriceId, quantity: addonUnits });
  }

  const stripe = createStripeClient(c.env);
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: lineItems,
    // Card-on-file trial, per PLAN.md's decided shape — 14 days is a
    // starting placeholder, not a confirmed decision; adjust freely.
    subscription_data: {
      trial_period_days: 14,
      metadata: { tenantId },
    },
    metadata: { tenantId },
    success_url: `${c.env.WEB_ORIGIN}/account?checkout=success`,
    cancel_url: `${c.env.WEB_ORIGIN}/account?checkout=cancelled`,
  });

  return c.json({ url: session.url });
});

// One-time (not recurring) purchase — 2 hours of guaranteed
// performance-8x processing, usable regardless of the tenant's tier.
// Unlike the tier/storage-addon flow, this has no "already have one"
// guard — a tenant can buy as many packs as they want, back to back.
stripeRoute.post("/checkout/burst", async (c) => {
  const tenantId = c.get("tenantId");
  const addon = getBurstAddon(c.env);

  const db = createDb(c.env.DATABASE_URL);
  const [existing] = await db
    .select({ stripeCustomerId: subscriptions.stripeCustomerId })
    .from(subscriptions)
    .where(eq(subscriptions.tenantId, tenantId))
    .limit(1);

  const stripe = createStripeClient(c.env);
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [{ price: addon.stripePriceId, quantity: 1 }],
    // A tenant who already has a Stripe customer (e.g. from a
    // subscription) must buy under that same customer — a fresh one
    // per purchase would detach the pack from their subscription in
    // the Customer Portal. Only a tenant with no customer yet (a Free
    // tenant's first-ever purchase) asks Stripe to create one, so a
    // stripeCustomerId still gets recorded (payment-mode Checkout
    // doesn't create one implicitly the way subscription-mode does).
    ...(existing?.stripeCustomerId
      ? { customer: existing.stripeCustomerId }
      : { customer_creation: "always" as const }),
    metadata: { tenantId, purpose: "burst" },
    success_url: `${c.env.WEB_ORIGIN}/account?checkout=success`,
    cancel_url: `${c.env.WEB_ORIGIN}/account?checkout=cancelled`,
  });

  return c.json({ url: session.url });
});

// Self-serve tier switching, storage add-on quantity changes, payment
// method updates, and invoice history — all handled by Stripe's
// hosted Customer Portal, not custom UI. 404s for a tenant with no
// Stripe customer on file yet (nothing to manage — see POST /checkout
// and POST /checkout/burst, either of which creates one).
stripeRoute.post("/portal", async (c) => {
  const tenantId = c.get("tenantId");
  const db = createDb(c.env.DATABASE_URL);
  const [existing] = await db
    .select({
      stripeCustomerId: subscriptions.stripeCustomerId,
      stripeSubscriptionId: subscriptions.stripeSubscriptionId,
    })
    .from(subscriptions)
    .where(eq(subscriptions.tenantId, tenantId))
    .limit(1);
  if (!existing?.stripeCustomerId) {
    return c.json(
      { error: "No billing account yet — choose a plan first" },
      404,
    );
  }

  const stripe = createStripeClient(c.env);

  // The subscription's own customer is the source of truth for what the
  // portal should show. An earlier bug let a burst-pack purchase
  // overwrite stripeCustomerId with a separate, subscription-less
  // customer; reconcile here so an affected tenant heals on next open.
  let customerId = existing.stripeCustomerId;
  if (existing.stripeSubscriptionId) {
    const subscription = await stripe.subscriptions.retrieve(
      existing.stripeSubscriptionId,
    );
    const subscriptionCustomerId =
      typeof subscription.customer === "string"
        ? subscription.customer
        : subscription.customer.id;
    if (subscriptionCustomerId !== customerId) {
      customerId = subscriptionCustomerId;
      await db
        .update(subscriptions)
        .set({ stripeCustomerId: customerId })
        .where(eq(subscriptions.tenantId, tenantId));
    }
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${c.env.WEB_ORIGIN}/account`,
  });

  return c.json({ url: session.url });
});

// In-app tier switch for a tenant who already has a subscription —
// swaps the tier line item's Price in place (storage add-on item, if
// any, is untouched) and prorates. The Customer Portal above can do
// the same; this just avoids the redirect for the common case. The
// local subscriptions row is updated right here rather than waiting on
// the customer.subscription.updated webhook, so the account page
// reflects the change on its very next read.
stripeRoute.post("/change-plan", async (c) => {
  const tenantId = c.get("tenantId");
  const body = await c.req.json<{ tier?: string }>();

  const tiers = getTiers(c.env);
  const target = tiers[body.tier as TierSlug];
  if (!target || !target.stripePriceId) {
    return c.json({ error: "tier must be one of small, medium, large" }, 400);
  }

  const db = createDb(c.env.DATABASE_URL);
  const [existing] = await db
    .select({
      plan: subscriptions.plan,
      stripeSubscriptionId: subscriptions.stripeSubscriptionId,
      storageAddonUnits: subscriptions.storageAddonUnits,
    })
    .from(subscriptions)
    .where(eq(subscriptions.tenantId, tenantId))
    .limit(1);
  if (!existing?.stripeSubscriptionId) {
    return c.json(
      { error: "No active subscription — choose a plan first" },
      409,
    );
  }
  if (existing.plan === target.slug) {
    return c.json({ error: "Already on that plan" }, 400);
  }

  // Refuse a downgrade that would leave the tenant over their new cap —
  // uploads are only gated going forward, so this would strand stored
  // files above a limit they'd then be unable to fix by uploading less.
  const newCap = getCapBytes(c.env, target.slug, existing.storageAddonUnits);
  const usedBytes = await getUsedBytes(db, tenantId);
  if (usedBytes > newCap) {
    return c.json(
      {
        error: `You're using more storage than ${target.name} includes — free up space or add storage first`,
      },
      409,
    );
  }

  const stripe = createStripeClient(c.env);
  const subscription = await stripe.subscriptions.retrieve(
    existing.stripeSubscriptionId,
  );
  const tierPriceIds = new Set(
    (Object.values(tiers) as (typeof tiers)[TierSlug][])
      .map((t) => t.stripePriceId)
      .filter((id): id is string => id !== null),
  );
  const tierItem = subscription.items.data.find((item) =>
    tierPriceIds.has(item.price.id),
  );
  if (!tierItem) {
    return c.json({ error: "Subscription has no tier item to change" }, 409);
  }

  // Picking a paid tier means staying subscribed, so this also calls
  // off any pending "Switch to Free".
  const updated = await stripe.subscriptions.update(subscription.id, {
    items: [{ id: tierItem.id, price: target.stripePriceId }],
    proration_behavior: "create_prorations",
    cancel_at_period_end: false,
  });

  const { plan, storageAddonUnits, currentPeriodEnd } =
    planFromSubscriptionItems(c.env, updated.items.data);
  await db
    .update(subscriptions)
    .set({
      plan,
      storageAddonUnits,
      currentPeriodEnd,
      cancelAtPeriodEnd: false,
    })
    .where(eq(subscriptions.tenantId, tenantId));

  return c.json({ plan });
});

// "Switch to Free" — ends the subscription at the close of the period
// already paid for, rather than immediately, so the tenant keeps what
// they paid for. customer.subscription.deleted (webhooks.ts) moves them
// to Free when it actually ends. Existing files are never deleted by a
// downgrade: if they're over Free's cap, uploads are refused until
// they're back under it (uploads.ts), nothing more.
async function setCancelAtPeriodEnd(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  cancel: boolean,
) {
  const tenantId = c.get("tenantId");
  const db = createDb(c.env.DATABASE_URL);
  const [existing] = await db
    .select({ stripeSubscriptionId: subscriptions.stripeSubscriptionId })
    .from(subscriptions)
    .where(eq(subscriptions.tenantId, tenantId))
    .limit(1);
  if (!existing?.stripeSubscriptionId) {
    return c.json({ error: "No active subscription" }, 409);
  }

  const stripe = createStripeClient(c.env);
  const updated = await stripe.subscriptions.update(
    existing.stripeSubscriptionId,
    { cancel_at_period_end: cancel },
  );
  await db
    .update(subscriptions)
    .set({ cancelAtPeriodEnd: updated.cancel_at_period_end })
    .where(eq(subscriptions.tenantId, tenantId));

  return c.json({ cancelAtPeriodEnd: updated.cancel_at_period_end });
}

stripeRoute.post("/cancel", (c) => setCancelAtPeriodEnd(c, true));
stripeRoute.post("/resume", (c) => setCancelAtPeriodEnd(c, false));
