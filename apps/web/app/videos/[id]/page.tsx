import { auth } from "@clerk/nextjs/server";
import { eq, and } from "drizzle-orm";
import { createDb, tenants, sourceVideos, clips } from "@scenestealer/db";
import { notFound } from "next/navigation";
import Link from "next/link";
import { AnalyzeControl } from "./analyze-control";
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
      <Link href="/">&larr; Back to recordings</Link>
      <h1>{video.title ?? "Untitled recording"}</h1>
      <AnalyzeControl
        sourceVideoId={video.id}
        initialStatus={video.status}
        initialError={video.analysisError}
        initialDurationSec={video.durationSec}
      />
      {/*
        Keyed on status so ClipEditor fully remounts the moment analysis
        finishes, not just re-renders with new props. AnalyzeControl's
        own poll already calls router.refresh() on completion, which
        re-runs this Server Component and would hand ClipEditor fresh
        `initialClips` — but ClipEditor is a client component whose
        clipList state (useState(initialClips)) and waveform-fetch
        effect only run once on mount, so a prop change alone never
        reaches them. Confirmed for real (2026-09-07): a user who
        stayed on this page while analysis finished got stuck seeing
        "waveform unavailable" and no detected clips — both genuinely
        existed in the DB/R2 by then, a full page reload showed them
        correctly. The key forces React to tear down and recreate
        ClipEditor exactly on that transition, so its effects re-run
        against the now-current data instead of needing a manual reload.
      */}
      <ClipEditor
        key={video.status}
        sourceVideoId={video.id}
        initialClips={videoClips}
      />
    </main>
  );
}
