import Link from "next/link";
import { eq } from "drizzle-orm";
import { createDb, sourceVideos } from "@scenestealer/db";

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
          <li
            key={video.id}
            style={{ padding: "0.5rem 0", borderBottom: "1px solid #333" }}
          >
            <Link href={`/videos/${video.id}`}>{video.title ?? video.id}</Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
