import { Hono } from "hono";
import { setCookie, deleteCookie, getCookie } from "hono/cookie";
import { eq } from "drizzle-orm";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
} from "@simplewebauthn/server";
import {
  createDb,
  adminCredentials,
  adminSessions,
  adminRecoveryCodes,
  type Database,
} from "@scenestealer/db";
import {
  requireAdmin,
  ADMIN_SESSION_COOKIE,
  type AdminVariables,
} from "../auth.js";
import {
  randomToken,
  sha256Hex,
  generateRecoveryCode,
  bytesToBase64url,
  base64urlToBytes,
} from "../admin-crypto.js";
import type { Env } from "../index.js";

export const adminAuth = new Hono<{ Bindings: Env; Variables: AdminVariables }>();

// Must match the origin this is actually served from (apps/web, same
// origin as WEB_ORIGIN) — WebAuthn ties credentials to this domain and
// won't work across a mismatch.
const RP_NAME = "SceneStealer Admin";
const RP_ID = "scenestealer.app";
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
// Short on purpose — this surface is used rarely, so forcing periodic
// re-auth costs little and keeps a stolen/left-open session's blast
// radius small.
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const RECOVERY_CODE_COUNT = 10;

function getChallengeStore(env: Env) {
  const id = env.ADMIN_CHALLENGE_STORE.idFromName("admin-webauthn");
  return env.ADMIN_CHALLENGE_STORE.get(id);
}

async function issueSession(
  c: { header: (name: string, value: string, options?: { append?: boolean }) => void },
  env: Env,
  db: Database,
): Promise<void> {
  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  await db.insert(adminSessions).values({
    tokenHash,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
  setCookie(c as never, ADMIN_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "Strict",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

// Replaces the whole recovery-code set — used both for the very first
// batch (setup) and for a deliberate regeneration. Old codes stop
// working the instant this runs, same as rotating any other credential.
async function replaceRecoveryCodes(db: Database): Promise<string[]> {
  await db.delete(adminRecoveryCodes);
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () =>
    generateRecoveryCode(),
  );
  const rows = await Promise.all(
    codes.map(async (code) => ({ codeHash: await sha256Hex(code) })),
  );
  await db.insert(adminRecoveryCodes).values(rows);
  return codes;
}

async function existingCredentials(db: Database) {
  const rows = await db
    .select({ credentialId: adminCredentials.credentialId })
    .from(adminCredentials);
  return rows.map((r) => ({ id: r.credentialId }));
}

// --- One-time bootstrap — no admin exists yet, so requireAdmin can't
// gate this. ADMIN_SETUP_TOKEN is the gate instead; rotate/delete it
// after real first use so this can't register a second identity later.
adminAuth.post("/setup/options", async (c) => {
  if (c.req.header("X-Setup-Token") !== c.env.ADMIN_SETUP_TOKEN) {
    return c.json({ error: "Invalid setup token" }, 401);
  }
  const db = createDb(c.env.DATABASE_URL);
  const [existing] = await db
    .select({ id: adminCredentials.id })
    .from(adminCredentials)
    .limit(1);
  if (existing) {
    return c.json({ error: "Admin already set up — use /register instead" }, 409);
  }

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userName: "admin",
    userDisplayName: "SceneStealer Admin",
    attestationType: "none",
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "preferred",
    },
  });
  await getChallengeStore(c.env).setChallenge(options.challenge, CHALLENGE_TTL_MS);
  return c.json(options);
});

adminAuth.post("/setup/verify", async (c) => {
  if (c.req.header("X-Setup-Token") !== c.env.ADMIN_SETUP_TOKEN) {
    return c.json({ error: "Invalid setup token" }, 401);
  }
  const db = createDb(c.env.DATABASE_URL);
  const [existing] = await db
    .select({ id: adminCredentials.id })
    .from(adminCredentials)
    .limit(1);
  if (existing) {
    return c.json({ error: "Admin already set up" }, 409);
  }

  const body = await c.req.json<{
    response: RegistrationResponseJSON;
    label: string;
  }>();
  const challenge = await getChallengeStore(c.env).consumeChallenge();
  if (!challenge) {
    return c.json({ error: "Challenge expired — try again" }, 400);
  }

  const verification = await verifyRegistrationResponse({
    response: body.response,
    expectedChallenge: challenge,
    expectedOrigin: c.env.WEB_ORIGIN,
    expectedRPID: RP_ID,
  });
  if (!verification.verified || !verification.registrationInfo) {
    return c.json({ error: "Passkey verification failed" }, 400);
  }

  const { credential } = verification.registrationInfo;
  await db.insert(adminCredentials).values({
    credentialId: credential.id,
    publicKey: bytesToBase64url(credential.publicKey),
    counter: credential.counter,
    transports: credential.transports ?? [],
    label: body.label || "First passkey",
  });

  const codes = await replaceRecoveryCodes(db);
  await issueSession(c, c.env, db);
  // Codes are returned exactly once — the caller must show/save them
  // now, nothing else in this API can produce the plaintext again.
  return c.json({ recoveryCodes: codes });
});

// --- Registering an additional passkey — requires an existing session,
// which is how the "2+ devices" recovery plan and post-recovery-code
// re-registration both actually happen.
adminAuth.post("/register/options", requireAdmin, async (c) => {
  const db = createDb(c.env.DATABASE_URL);
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userName: "admin",
    userDisplayName: "SceneStealer Admin",
    attestationType: "none",
    excludeCredentials: await existingCredentials(db),
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "preferred",
    },
  });
  await getChallengeStore(c.env).setChallenge(options.challenge, CHALLENGE_TTL_MS);
  return c.json(options);
});

adminAuth.post("/register/verify", requireAdmin, async (c) => {
  const body = await c.req.json<{
    response: RegistrationResponseJSON;
    label: string;
  }>();
  const challenge = await getChallengeStore(c.env).consumeChallenge();
  if (!challenge) {
    return c.json({ error: "Challenge expired — try again" }, 400);
  }

  const verification = await verifyRegistrationResponse({
    response: body.response,
    expectedChallenge: challenge,
    expectedOrigin: c.env.WEB_ORIGIN,
    expectedRPID: RP_ID,
  });
  if (!verification.verified || !verification.registrationInfo) {
    return c.json({ error: "Passkey verification failed" }, 400);
  }

  const { credential } = verification.registrationInfo;
  const db = createDb(c.env.DATABASE_URL);
  await db.insert(adminCredentials).values({
    credentialId: credential.id,
    publicKey: bytesToBase64url(credential.publicKey),
    counter: credential.counter,
    transports: credential.transports ?? [],
    label: body.label || "Untitled passkey",
  });
  return c.json({ ok: true });
});

// --- Normal sign-in.
adminAuth.post("/login/options", async (c) => {
  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    userVerification: "preferred",
  });
  await getChallengeStore(c.env).setChallenge(options.challenge, CHALLENGE_TTL_MS);
  return c.json(options);
});

adminAuth.post("/login/verify", async (c) => {
  const body = await c.req.json<{ response: AuthenticationResponseJSON }>();
  const challenge = await getChallengeStore(c.env).consumeChallenge();
  if (!challenge) {
    return c.json({ error: "Challenge expired — try again" }, 400);
  }

  const db = createDb(c.env.DATABASE_URL);
  const [stored] = await db
    .select()
    .from(adminCredentials)
    .where(eq(adminCredentials.credentialId, body.response.id))
    .limit(1);
  if (!stored) {
    return c.json({ error: "Unrecognized passkey" }, 401);
  }

  const verification = await verifyAuthenticationResponse({
    response: body.response,
    expectedChallenge: challenge,
    expectedOrigin: c.env.WEB_ORIGIN,
    expectedRPID: RP_ID,
    credential: {
      id: stored.credentialId,
      publicKey: base64urlToBytes(stored.publicKey),
      counter: stored.counter,
      transports: (stored.transports as string[] | null) ?? undefined,
    },
  });
  if (!verification.verified) {
    return c.json({ error: "Passkey verification failed" }, 401);
  }

  // Reject a counter that didn't advance — the classic signal of a
  // cloned authenticator replaying a previous response.
  if (verification.authenticationInfo.newCounter <= stored.counter) {
    return c.json({ error: "Replay detected" }, 401);
  }
  await db
    .update(adminCredentials)
    .set({ counter: verification.authenticationInfo.newCounter })
    .where(eq(adminCredentials.id, stored.id));

  await issueSession(c, c.env, db);
  return c.json({ ok: true });
});

// --- Recovery-code redemption — a break-glass path, not a parallel
// login method: the frontend must immediately prompt registering a new
// passkey after this succeeds (register/options above, now reachable
// since this issues a real session).
adminAuth.post("/recovery/redeem", async (c) => {
  const body = await c.req.json<{ code: string }>();
  const codeHash = await sha256Hex(body.code.trim());
  const db = createDb(c.env.DATABASE_URL);
  const [row] = await db
    .select({ id: adminRecoveryCodes.id, usedAt: adminRecoveryCodes.usedAt })
    .from(adminRecoveryCodes)
    .where(eq(adminRecoveryCodes.codeHash, codeHash))
    .limit(1);
  if (!row || row.usedAt) {
    return c.json({ error: "Invalid or already-used recovery code" }, 401);
  }

  await db
    .update(adminRecoveryCodes)
    .set({ usedAt: new Date() })
    .where(eq(adminRecoveryCodes.id, row.id));
  await issueSession(c, c.env, db);
  return c.json({ ok: true, mustRegisterPasskey: true });
});

adminAuth.post("/recovery/regenerate", requireAdmin, async (c) => {
  const db = createDb(c.env.DATABASE_URL);
  const codes = await replaceRecoveryCodes(db);
  return c.json({ recoveryCodes: codes });
});

adminAuth.post("/logout", requireAdmin, async (c) => {
  const token = getCookie(c, ADMIN_SESSION_COOKIE);
  if (token) {
    const db = createDb(c.env.DATABASE_URL);
    const tokenHash = await sha256Hex(token);
    await db
      .update(adminSessions)
      .set({ revokedAt: new Date() })
      .where(eq(adminSessions.tokenHash, tokenHash));
  }
  deleteCookie(c, ADMIN_SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});
