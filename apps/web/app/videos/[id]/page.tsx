import { auth } from "@clerk/nextjs/server";
import { eq, and } from "drizzle-orm";
import { createDb, tenants, sourceVideos, clips } from "@scenestealer/db";
import { notFound } from "next/navigation";
import { ClipEditor } from "./clip-editor";

// Reads straight from the DB via @scenestealer/db (DATABASE_URL is
// available to this Server Component, unlike the browser) — matches the
// read-here / mutate-through-apps/api split: R2 credentials, which the
// clip editor's playback URL needs, only live in apps/api, so writes and
// anything R2-related still go through that Worker.
export default async function VideoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { orgId } = await auth();
  if (!orgId) {
    notFound();
  }

  const db = createDb(process.env.DATABASE_URL!);

  const [tenant] = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.clerkOrgId, orgId))
    .limit(1);
  if (!tenant) {
    notFound();
  }

  const [video] = await db
    .select()
    .from(sourceVideos)
    .where(and(eq(sourceVideos.id, id), eq(sourceVideos.tenantId, tenant.id)))
    .limit(1);
  if (!video) {
    notFound();
  }

  const videoClips = await db
    .select()
    .from(clips)
    .where(eq(clips.sourceVideoId, video.id))
    .orderBy(clips.startSec);

  return (
    <main>
      <h1>{video.title ?? "Untitled recording"}</h1>
      <ClipEditor sourceVideoId={video.id} initialClips={videoClips} />
    </main>
  );
}
