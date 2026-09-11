export interface Env {
  POSTIZ_ORIGIN_URL: string;
  POSTIZ_PUBLIC_HOST: string;
  WEB_ORIGIN: string;
}

// Builds the injected script inline rather than as a separate asset —
// this Worker has no static-asset pipeline, and the script is tiny.
//
// Confirmed against Postiz's real source (ContinueIntegration's
// navigateOrShow, apps/frontend/src/components/launches/continue.
// integration.tsx): a real connect success never reloads the page.
// The OAuth provider's redirect_uri lands the popup on
// /integrations/social/[provider] (a genuine HTTP response this
// Worker does see), and that page's own async logic then calls
// Next.js's router.push("/launches?added=<provider>&msg=...") —
// client-side History API navigation, no new request. The original
// version of this script only checked location.search on load, which
// only ever fires when something loads /launches?added=... directly
// (e.g. a bookmark, or this Worker's own pre-cutover verification) —
// never during the actual live flow, confirmed live 2026-09-05 when a
// real connect still left the tenant on Postiz's calendar. Patching
// pushState/replaceState catches the transition at the moment it
// actually happens, regardless of which page it started from.
function buildInjectedScript(webOrigin: string): string {
  return `<script>(function(){
try {
  function maybeCloseFor(urlStr) {
    var target;
    try {
      target = new URL(urlStr, window.location.href);
    } catch (e) {
      return;
    }
    if (!target.searchParams.has("added")) return;
    try { window.close(); } catch (e) {}
    setTimeout(function () {
      window.location.href = ${JSON.stringify(`${webOrigin}/connections`)};
    }, 500);
  }

  // Covers a direct load of a URL that already carries the param.
  maybeCloseFor(window.location.href);

  // Covers the real flow's client-side router.push transition.
  ["pushState", "replaceState"].forEach(function (method) {
    var original = history[method];
    history[method] = function (state, title, url) {
      var result = original.apply(this, arguments);
      if (url) maybeCloseFor(url);
      return result;
    };
  });
} catch (e) {}
})();</script>`;
}

// Paths Postiz's own automated emails link to (its email footer template
// links to FRONTEND_URL + "/settings" on every email it sends) — redirected
// straight to our own equivalent page instead of ever rendering Postiz's
// UI. FRONTEND_URL itself can't just be repointed at our domain to fix
// this at the source: confirmed for real (2026-09-11) that Postiz uses
// that same variable to build the OAuth redirect_uri it sends to
// Facebook/Instagram/YouTube, which then has to match what's registered
// in each provider's app config — repointing it broke every connect flow
// outright ("URL Blocked" from Facebook). This redirect map is the
// narrow, safe alternative: only the specific paths confirmed to appear
// in Postiz's own outbound emails, nothing that would interfere with the
// OAuth flow's own pages (/integrations/social/*, /launches) that the
// injected-script logic below still needs Postiz to actually serve.
const EMAIL_LINK_REDIRECTS: Record<string, string> = {
  "/settings": "/settings",
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    const redirectTo = EMAIL_LINK_REDIRECTS[url.pathname];
    if (request.method === "GET" && redirectTo) {
      return Response.redirect(`${env.WEB_ORIGIN}${redirectTo}`, 302);
    }

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

    // /launches: covers a direct load of the success URL (this Worker's
    // own pre-cutover verification loaded it this way). /integrations/
    // social/: the actual OAuth redirect_uri destination for every
    // provider (confirmed against Postiz's source and ROADMAP.md's own
    // notes on the configured Facebook/Instagram/YouTube redirect
    // URIs) — the page the injected script's pushState/replaceState
    // patch above needs to be running on *before* the real flow's
    // client-side router.push away from it happens.
    const isRewriteTarget =
      url.pathname === "/launches" ||
      url.pathname.startsWith("/integrations/social/");

    const isCandidate =
      request.method === "GET" &&
      isRewriteTarget &&
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
