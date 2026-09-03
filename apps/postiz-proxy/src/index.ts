export interface Env {
  POSTIZ_ORIGIN_URL: string;
  POSTIZ_PUBLIC_HOST: string;
  WEB_ORIGIN: string;
}

// Builds the injected script inline rather than as a separate asset —
// this Worker has no static-asset pipeline, and the script is tiny.
// Deliberately does NOT gate on query params here in the Worker's own
// routing (see wrangler.toml's comment / ROADMAP.md): Postiz's
// /launches is a client-side-routed SPA view, so the connect-success
// `added=`/`msg=` params may only ever exist in the browser's address
// bar, never on a real server request. Reading `location.search` at
// script-execution time is correct either way.
function buildInjectedScript(webOrigin: string): string {
  return `<script>(function(){
try {
  var params = new URLSearchParams(window.location.search);
  if (!params.has("added")) return;
  try { window.close(); } catch (e) {}
  setTimeout(function () {
    window.location.href = ${JSON.stringify(`${webOrigin}/connections`)};
  }, 500);
} catch (e) {}
})();</script>`;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Rebuild the request against Postiz's real Fly hostname, not
    // postiz.scenestealer.app itself — fetching that hostname again
    // would re-enter Cloudflare's edge and hit this same Worker,
    // looping forever once it's routed there. Host is overridden
    // separately so Postiz's own app-layer code (cookie domain,
    // FRONTEND_URL-based logic) still sees the hostname it expects.
    const originUrl = new URL(env.POSTIZ_ORIGIN_URL);
    originUrl.pathname = url.pathname;
    originUrl.search = url.search;

    const originHeaders = new Headers(request.headers);
    originHeaders.set("Host", env.POSTIZ_PUBLIC_HOST);

    const originRequest = new Request(originUrl.toString(), {
      method: request.method,
      headers: originHeaders,
      body: request.body,
      redirect: "manual",
    });

    const originResponse = await fetch(originRequest);

    const isCandidate =
      request.method === "GET" &&
      url.pathname === "/launches" &&
      originResponse.status >= 200 &&
      originResponse.status < 300 &&
      (originResponse.headers.get("content-type") ?? "").startsWith(
        "text/html",
      );

    if (!isCandidate) {
      return originResponse;
    }

    const script = buildInjectedScript(env.WEB_ORIGIN);
    return new HTMLRewriter()
      .on("head", {
        element(element) {
          element.append(script, { html: true });
        },
      })
      .transform(originResponse);
  },
};
