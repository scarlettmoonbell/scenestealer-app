import { DurableObject } from "cloudflare:workers";

// Holds the single in-flight WebAuthn challenge between "generate
// options" and "verify response" for the admin passkey flow (see
// routes/admin-auth.ts). Addressed via a fixed idFromName("admin-webauthn")
// — effectively a singleton, since there's exactly one admin. A Durable
// Object rather than KV specifically because the challenge must be
// strongly consistent across Cloudflare's edge: a KV write can lag behind
// a read from a different colo, which would spuriously fail a real
// registration/login attempt.
export class AdminChallengeStore extends DurableObject {
  async setChallenge(challenge: string, ttlMs: number): Promise<void> {
    await this.ctx.storage.put("challenge", {
      value: challenge,
      expiresAt: Date.now() + ttlMs,
    });
  }

  // Consumes (deletes) the stored challenge regardless of outcome — a
  // challenge is one-time-use whether or not verification against it
  // ultimately succeeds, matching WebAuthn's own anti-replay intent.
  async consumeChallenge(): Promise<string | null> {
    const stored = await this.ctx.storage.get<{
      value: string;
      expiresAt: number;
    }>("challenge");
    await this.ctx.storage.delete("challenge");
    if (!stored || stored.expiresAt < Date.now()) return null;
    return stored.value;
  }
}
