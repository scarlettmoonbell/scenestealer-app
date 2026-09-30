import Stripe from "stripe";
import type { Env } from "./index.js";

// Workers has no Node `http`/`crypto` module, so the SDK needs the
// fetch-based HTTP client explicitly — its default Node client would
// fail at the first API call. webhooks.ts separately uses
// constructEventAsync (not constructEvent) for the same reason:
// signature verification needs Web Crypto, not Node's `crypto`.
export function createStripeClient(env: Env): Stripe {
  return new Stripe(env.STRIPE_SECRET_KEY, {
    httpClient: Stripe.createFetchHttpClient(),
  });
}
