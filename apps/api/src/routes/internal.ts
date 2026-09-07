import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { createClerkClient } from "@clerk/backend";
import { createDb, sourceVideos } from "@scenestealer/db";
import type { Env } from "../index.js";

// No Variables generic here (unlike videos.ts et al.) — this route
// carries no Clerk session and isn't mounted under requireTenant, so
// there's no tenantId/userId to type against; see the auth comment
// below.
export const internalRoute = new Hono<{ Bindings: Env }>();

// Called by apps/worker's analyze.ts once a job finishes (success or
// failure) — see that file's notifyApiOfCompletion. Purely to trigger
// emailing the tenant who kicked the run off; sourceVideos.status is
// already written directly by the worker itself by the time this fires,
// this route doesn't touch it.
//
// Not tenant-scoped and carries no Clerk session (the worker has
// neither), so this deliberately isn't mounted under videos.ts's
// `requireTenant` middleware — authenticated instead with the same
// WORKER_SHARED_SECRET bearer token already used for the reverse
// direction (apps/api -> apps/worker's own /analyze route).
internalRoute.post("/analysis-complete", async (c) => {
  if (
    c.req.header("Authorization") !== `Bearer ${c.env.WORKER_SHARED_SECRET}`
  ) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const body = await c.req.json<{
    sourceVideoId?: string;
    status?: "analyzed" | "failed";
    error?: string;
  }>();
  if (!body.sourceVideoId || !body.status) {
    return c.json({ error: "sourceVideoId and status are required" }, 400);
  }

  const db = createDb(c.env.DATABASE_URL);
  const [video] = await db
    .select()
    .from(sourceVideos)
    .where(eq(sourceVideos.id, body.sourceVideoId))
    .limit(1);

  // No video, or one analyzed before triggeredByClerkUserId existed, or
  // triggered some other way — nobody to email. Not an error: from the
  // worker's perspective this callback already did its job just by
  // being received.
  if (!video?.triggeredByClerkUserId) {
    return c.json({ notified: false });
  }

  // Alpha-phase: RESEND_API_KEY isn't provisioned everywhere yet (needs
  // a verified sending domain — see ROADMAP.md). Skip quietly rather
  // than erroring the whole callback over a missing notification
  // channel; the job's real status is already correct regardless.
  if (!c.env.RESEND_API_KEY) {
    console.log(
      `[analysis-complete] RESEND_API_KEY not configured — skipping email for sourceVideoId=${body.sourceVideoId}`,
    );
    return c.json({ notified: false });
  }

  try {
    const clerkClient = createClerkClient({
      secretKey: c.env.CLERK_SECRET_KEY,
    });
    const user = await clerkClient.users.getUser(video.triggeredByClerkUserId);
    const email = user.primaryEmailAddress?.emailAddress;
    if (!email) {
      console.log(
        `[analysis-complete] no email on file for Clerk user ${video.triggeredByClerkUserId} (sourceVideoId=${body.sourceVideoId})`,
      );
      return c.json({ notified: false });
    }

    const videoUrl = `${c.env.WEB_ORIGIN}/videos/${video.id}`;
    const title = video.title ?? "Your video";
    const subject =
      body.status === "analyzed"
        ? `${title} finished analyzing`
        : `${title} failed to analyze`;
    const html =
      body.status === "analyzed"
        ? `<p>${title} finished analyzing — clips are ready to review.</p><p><a href="${videoUrl}">Open it in SceneStealer</a></p>`
        : `<p>${title} failed to analyze: ${body.error ?? "Unknown error"}.</p><p><a href="${videoUrl}">Open it in SceneStealer</a> to retry.</p>`;

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${c.env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: "SceneStealer <notifications@scenestealer.app>",
        to: email,
        subject,
        html,
      }),
    });
    if (!resendRes.ok) {
      console.error(
        `[analysis-complete] Resend send failed: ${resendRes.status} ${await resendRes.text()}`,
      );
      return c.json({ notified: false }, 502);
    }

    return c.json({ notified: true });
  } catch (e) {
    console.error(
      `[analysis-complete] failed to notify for sourceVideoId=${body.sourceVideoId}:`,
      e,
    );
    return c.json({ notified: false }, 500);
  }
});
