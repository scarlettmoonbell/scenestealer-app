import type { Env } from "./index.js";

// Confirmed against the real, deployed instance (not just docs.postiz.com):
// the base path is /api/public/v1 — the bare /public/v1 path from the docs
// 307-redirects to Postiz's own frontend login, it isn't the API route.
// Auth is the raw key in the Authorization header, no "Bearer " prefix.
async function postizFetch(
  env: Env,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  return fetch(`${env.POSTIZ_API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: env.POSTIZ_API_KEY,
      ...init?.headers,
    },
  });
}

export interface PostizIntegration {
  id: string;
  name: string;
  identifier: string;
  picture?: string;
  disabled?: boolean;
  profile?: string;
  customer?: { id: string; name: string };
}

export async function getIntegrations(env: Env): Promise<PostizIntegration[]> {
  const res = await postizFetch(env, "/integrations");
  if (!res.ok) {
    throw new Error(`Postiz GET /integrations failed: ${res.status}`);
  }
  return res.json();
}

export async function getConnectUrl(
  env: Env,
  platform: string,
): Promise<string> {
  const res = await postizFetch(env, `/social/${platform}`);
  if (!res.ok) {
    throw new Error(`Postiz GET /social/${platform} failed: ${res.status}`);
  }
  const body = (await res.json()) as { url: string };
  return body.url;
}

export async function deleteIntegration(
  env: Env,
  integrationId: string,
): Promise<void> {
  const res = await postizFetch(env, `/integrations/${integrationId}`, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(
      `Postiz DELETE /integrations/${integrationId} failed: ${res.status}`,
    );
  }
}

// Confirmed real shape for a YouTube integration: settings.required names
// which fields the publish `settings` object needs beyond the caption —
// e.g. YouTube needs a video title and a public/private/unlisted type.
// Different platforms need different fields; this is read at publish-UI
// time rather than hardcoded per platform.
export interface PostizIntegrationSettings {
  output: {
    rules: string;
    maxLength: number;
    settings: {
      properties: Record<
        string,
        { type?: string; enum?: string[]; [key: string]: unknown }
      >;
      required?: string[];
    };
    tools: unknown[];
  };
}

export async function getIntegrationSettings(
  env: Env,
  integrationId: string,
): Promise<PostizIntegrationSettings> {
  const res = await postizFetch(env, `/integration-settings/${integrationId}`);
  if (!res.ok) {
    throw new Error(
      `Postiz GET /integration-settings/${integrationId} failed: ${res.status}`,
    );
  }
  return res.json();
}

export interface CreatePostResult {
  postId: string;
  integration: string;
}

export async function createPost(
  env: Env,
  params: {
    integrationId: string;
    platform: string;
    content: string;
    mediaUrl: string;
    settings: Record<string, unknown>;
    // ISO date string. Present -> Postiz queues it for that time
    // (`type: "schedule"`); absent -> publishes immediately (`type: "now"`),
    // the existing behavior.
    scheduledFor?: string;
  },
): Promise<CreatePostResult[]> {
  const res = await postizFetch(env, "/posts", {
    method: "POST",
    body: JSON.stringify({
      type: params.scheduledFor ? "schedule" : "now",
      date: params.scheduledFor ?? new Date().toISOString(),
      shortLink: false,
      tags: [],
      posts: [
        {
          integration: { id: params.integrationId },
          value: [
            {
              content: params.content,
              image: [{ id: "clip", path: params.mediaUrl }],
            },
          ],
          settings: { __type: params.platform, ...params.settings },
        },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Postiz POST /posts failed: ${res.status} ${body}`);
  }
  return res.json();
}

export async function cancelPost(env: Env, postId: string): Promise<void> {
  const res = await postizFetch(env, `/posts/${postId}`, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`Postiz DELETE /posts/${postId} failed: ${res.status}`);
  }
}
