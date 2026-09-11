import { eq } from "drizzle-orm";
import { createDb, tenants } from "@scenestealer/db";
import type { Env } from "./index.js";

// Fires the moment a post's real state (checked against Postiz, not
// assumed) resolves to "failed" — see posts.ts's reconcileDuePosts and
// GET /:id/status, the only two places that ever write that status.
// Links to our own Scheduling page, never Postiz's — the whole point
// of this feature (2026-09-11) is a tenant should never need to know
// Postiz exists. Best-effort throughout: a tenant with notifications
// off, no address on file, or RESEND_API_KEY unset (same gap as
// routes/internal.ts's analyze-completion email) just means no email,
// never a failed publish.
export async function notifyPublishFailure(
  env: Env,
  tenantId: string,
  details: { platform: string; error: string | null },
): Promise<void> {
  if (!env.RESEND_API_KEY) {
    return;
  }

  const db = createDb(env.DATABASE_URL);
  const [tenant] = await db
    .select({
      notificationEmail: tenants.notificationEmail,
      notifyOnPublishFailure: tenants.notifyOnPublishFailure,
    })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  if (!tenant?.notifyOnPublishFailure || !tenant.notificationEmail) {
    return;
  }

  const schedulingUrl = `${env.WEB_ORIGIN}/scheduled`;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: "SceneStealer <notifications@scenestealer.app>",
        to: tenant.notificationEmail,
        subject: `A ${details.platform} post failed to publish`,
        html: `<p>A post to ${details.platform} failed to publish: ${details.error ?? "Unknown error"}.</p><p><a href="${schedulingUrl}">Open Scheduling in SceneStealer</a> to review it.</p><p style="font-size: 0.85em; color: #666;">Turn these emails off anytime in Settings.</p>`,
      }),
    });
  } catch (e) {
    console.error(
      `[notifyPublishFailure] failed to send for tenant ${tenantId}:`,
      e,
    );
  }
}
