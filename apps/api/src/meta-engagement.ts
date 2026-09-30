import { GRAPH_API_VERSION } from "./facebook-graph.js";

// Comments and basic insights for one post SceneStealer published, read
// with the Page token Postiz holds (see postiz-db.ts). Each call maps to
// one Meta permission, which is what App Review checks:
//   Facebook  comments  pages_read_user_content (+ pages_read_engagement)
//             replies   pages_manage_engagement
//             insights  read_insights
//   Instagram comments  instagram_manage_comments
//             replies   instagram_manage_comments
//             insights  instagram_manage_insights

export interface EngagementComment {
  id: string;
  author: string | null;
  message: string;
  createdTime: string;
  replies: EngagementComment[];
}

export interface EngagementStat {
  label: string;
  value: number;
}

export interface Engagement {
  comments: EngagementComment[];
  stats: EngagementStat[];
  // Set when insights couldn't be read (e.g. too soon after publishing,
  // or a video type the metrics don't cover). Comments still load.
  statsError?: string;
}

const COMMENT_LIMIT = 25;

async function graphGet<T>(
  path: string,
  params: Record<string, string>,
  accessToken: string,
): Promise<T> {
  const url = new URL(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${path}`,
  );
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("access_token", accessToken);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Graph API GET /${path} failed: ${res.status} ${await res.text()}`,
    );
  }
  return res.json<T>();
}

async function graphPost<T>(
  path: string,
  params: Record<string, string>,
  accessToken: string,
): Promise<T> {
  const body = new URLSearchParams({ ...params, access_token: accessToken });
  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${path}`,
    { method: "POST", body },
  );
  if (!res.ok) {
    throw new Error(
      `Graph API POST /${path} failed: ${res.status} ${await res.text()}`,
    );
  }
  return res.json<T>();
}

interface InsightRow {
  name: string;
  values?: { value: number | Record<string, number> }[];
  total_value?: { value: number };
}

function insightValue(row: InsightRow): number | null {
  const v = row.total_value?.value ?? row.values?.[0]?.value;
  return typeof v === "number" ? v : null;
}

// --- Facebook -------------------------------------------------------------

interface FbComment {
  id: string;
  message?: string;
  created_time: string;
  from?: { name?: string };
  comments?: { data: FbComment[] };
}

function mapFbComment(c: FbComment): EngagementComment {
  return {
    id: c.id,
    author: c.from?.name ?? null,
    message: c.message ?? "",
    createdTime: c.created_time,
    replies: (c.comments?.data ?? []).map(mapFbComment),
  };
}

const FB_STAT_LABELS: Record<string, string> = {
  fb_reels_total_plays: "Plays",
  post_impressions_unique: "Reach",
  total_video_views: "Views",
  total_video_views_unique: "Unique viewers",
};

async function getFacebookComments(
  videoId: string,
  token: string,
): Promise<EngagementComment[]> {
  const fields = "id,message,created_time,from{name}";
  const { data } = await graphGet<{ data: FbComment[] }>(
    `${videoId}/comments`,
    {
      fields: `${fields},comments.limit(10){${fields}}`,
      filter: "toplevel",
      order: "reverse_chronological",
      limit: String(COMMENT_LIMIT),
    },
    token,
  );
  return data.map(mapFbComment);
}

async function getFacebookStats(
  videoId: string,
  token: string,
): Promise<EngagementStat[]> {
  // Postiz publishes clips as Reels, whose metrics differ from classic
  // video metrics; fall back to the classic set for a non-Reel video.
  const metricSets = [
    "fb_reels_total_plays,post_impressions_unique",
    "total_video_views,total_video_views_unique",
  ];
  let lastError: unknown;
  for (const metric of metricSets) {
    try {
      const { data } = await graphGet<{ data: InsightRow[] }>(
        `${videoId}/video_insights`,
        { metric },
        token,
      );
      const stats = data
        .map((row) => ({
          label: FB_STAT_LABELS[row.name] ?? row.name,
          value: insightValue(row),
        }))
        .filter((s): s is EngagementStat => s.value !== null);
      if (stats.length > 0) return stats;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError ?? new Error("No insights available yet");
}

// --- Instagram ------------------------------------------------------------

interface IgComment {
  id: string;
  text?: string;
  username?: string;
  timestamp: string;
  replies?: { data: IgComment[] };
}

function mapIgComment(c: IgComment): EngagementComment {
  return {
    id: c.id,
    author: c.username ?? null,
    message: c.text ?? "",
    createdTime: c.timestamp,
    replies: (c.replies?.data ?? []).map(mapIgComment),
  };
}

const IG_STAT_LABELS: Record<string, string> = {
  views: "Views",
  reach: "Reach",
  likes: "Likes",
  comments: "Comments",
  shares: "Shares",
};

async function getInstagramComments(
  mediaId: string,
  token: string,
): Promise<EngagementComment[]> {
  const fields = "id,text,username,timestamp";
  const { data } = await graphGet<{ data: IgComment[] }>(
    `${mediaId}/comments`,
    { fields: `${fields},replies{${fields}}`, limit: String(COMMENT_LIMIT) },
    token,
  );
  return data.map(mapIgComment);
}

async function getInstagramStats(
  mediaId: string,
  token: string,
): Promise<EngagementStat[]> {
  const { data } = await graphGet<{ data: InsightRow[] }>(
    `${mediaId}/insights`,
    { metric: "views,reach,likes,comments,shares" },
    token,
  );
  return data
    .map((row) => ({
      label: IG_STAT_LABELS[row.name] ?? row.name,
      value: insightValue(row),
    }))
    .filter((s): s is EngagementStat => s.value !== null);
}

// --- Public ---------------------------------------------------------------

export type EngagementProvider = "facebook" | "instagram";

export async function getEngagement(
  provider: EngagementProvider,
  releaseId: string,
  token: string,
): Promise<Engagement> {
  const [comments, stats] = await Promise.all([
    provider === "facebook"
      ? getFacebookComments(releaseId, token)
      : getInstagramComments(releaseId, token),
    (provider === "facebook"
      ? getFacebookStats(releaseId, token)
      : getInstagramStats(releaseId, token)
    ).then(
      (s) => ({ stats: s }),
      (err: unknown) => ({
        stats: [] as EngagementStat[],
        statsError: err instanceof Error ? err.message : String(err),
      }),
    ),
  ]);
  return { comments, ...stats };
}

// Replies to a top-level comment on the given post. The comment must be
// one of that post's own top-level comments — checked against the live
// list, so a caller can't use this to post under an arbitrary object id.
export async function replyToComment(
  provider: EngagementProvider,
  releaseId: string,
  commentId: string,
  message: string,
  token: string,
): Promise<{ id: string }> {
  const comments =
    provider === "facebook"
      ? await getFacebookComments(releaseId, token)
      : await getInstagramComments(releaseId, token);
  if (!comments.some((c) => c.id === commentId)) {
    throw new CommentNotOnPostError();
  }
  return provider === "facebook"
    ? graphPost<{ id: string }>(`${commentId}/comments`, { message }, token)
    : graphPost<{ id: string }>(`${commentId}/replies`, { message }, token);
}

export class CommentNotOnPostError extends Error {
  constructor() {
    super("That comment isn't on this post");
  }
}
