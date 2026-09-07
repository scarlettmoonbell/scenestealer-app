import { eq } from "drizzle-orm";
import { createDb, sourceVideos } from "@scenestealer/db";
import { VideoListItem } from "./video-list-item";
import { TABLE_HEADER_STYLE } from "./table-header-style";

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
      <div style={{ marginTop: "1rem", overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th
                scope="col"
                style={{
                  ...TABLE_HEADER_STYLE,
                  textAlign: "left",
                  padding: "0.5rem 0.75rem 0.5rem 0",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                Filename
              </th>
              <th
                scope="col"
                style={{
                  ...TABLE_HEADER_STYLE,
                  textAlign: "right",
                  padding: "0.5rem 0 0.5rem 0.75rem",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                Manage
              </th>
            </tr>
          </thead>
          <tbody>
            {videos.map((video, index) => (
              <VideoListItem
                key={video.id}
                id={video.id}
                title={video.title ?? video.id}
                striped={index % 2 === 1}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
