// A narrow, read-only Facebook Graph API client — exists solely to
// genuinely exercise the pages_read_engagement permission (reading real
// content posted by a connected Page), not to build out a general
// Facebook integration. Publishing still goes through Postiz, unchanged.
const GRAPH_API_VERSION = "v26.0";

export interface FacebookPagePost {
  id: string;
  message?: string;
  createdTime: string;
  permalinkUrl?: string;
  fullPicture?: string;
}

export async function getPagePosts(
  pageId: string,
  accessToken: string,
  limit = 5,
): Promise<FacebookPagePost[]> {
  const url = new URL(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${pageId}/posts`,
  );
  url.searchParams.set(
    "fields",
    "id,message,created_time,permalink_url,full_picture",
  );
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("access_token", accessToken);

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Facebook Graph API GET /${pageId}/posts failed: ${res.status} ${body}`);
  }
  const { data } = await res.json<{
    data: Array<{
      id: string;
      message?: string;
      created_time: string;
      permalink_url?: string;
      full_picture?: string;
    }>;
  }>();

  return data.map((post) => ({
    id: post.id,
    message: post.message,
    createdTime: post.created_time,
    permalinkUrl: post.permalink_url,
    fullPicture: post.full_picture,
  }));
}
