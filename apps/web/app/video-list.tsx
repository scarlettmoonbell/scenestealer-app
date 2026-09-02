import { eq } from "drizzle-orm";
import { createDb, sourceVideos } from "@scenestealer/db";
import { VideoListItem } from "./video-list-item";

export async function VideoList({ tenantId }: { tenantId: string }) {
  const db = createDb(process.env.DATABASE_URL!);
  const videos = await db
    .select()
    .from(sourceVideos)
    .where(eq(sourceVideos.tenantId, tenantId))
    .orderBy(sourceVideos.createdAt);

  if (videos.length === 0) return null;

  return (
    <section>
      <h2>Your recordings</h2>
      <ul style={{ listStyle: "none", padding: 0 }}>
        {videos.map((video) => (
          <VideoListItem
            key={video.id}
            id={video.id}
            title={video.title ?? video.id}
          />
        ))}
      </ul>
    </section>
  );
}
