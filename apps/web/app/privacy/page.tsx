export const metadata = {
  title: "Privacy Policy — SceneStealer",
};

// Public, unauthenticated route — required as a live URL for Meta App
// Review (and any other OAuth platform's developer console) before it
// will let an app request advanced permissions. Reflects this app's
// actual architecture as of Phase 6; needs a real legal read before
// this is relied on for anything beyond that (see ROADMAP.md).
export default function PrivacyPolicyPage() {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "2rem 1rem" }}>
      <h1>Privacy Policy</h1>
      <p>
        <em>Last updated: 2026-08-25</em>
      </p>

      <p>
        SceneStealer (&ldquo;we,&rdquo; &ldquo;us&rdquo;) provides software that
        helps live-theater operators turn full-length show recordings into short
        highlight clips for social media. This policy explains what data we
        collect, why, and how you can control it.
      </p>

      <h2>Who this applies to</h2>
      <p>
        SceneStealer is a business-to-business product. Our customers
        (&ldquo;tenants&rdquo;) are theater companies and similar organizations;
        each tenant&rsquo;s own staff are the people who sign in and use the
        product. This policy covers both tenants and the individual people who
        use a tenant&rsquo;s account.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>
          <strong>Account information</strong>: name, email address, and
          organization membership, handled by our authentication provider,
          Clerk.
        </li>
        <li>
          <strong>Content you upload</strong>: full-length show recordings
          (video/audio files) you upload for processing.
        </li>
        <li>
          <strong>Content we generate from it</strong>: automatic transcripts,
          scene-boundary and audio-energy analysis, AI-scored highlight
          suggestions, and the rendered clips produced once you accept a
          suggestion.
        </li>
        <li>
          <strong>Publishing connections</strong>: if you choose to connect a
          social/video platform (currently YouTube; Instagram and Facebook once
          available), we store the access token that platform issues to us,
          scoped to the permissions you granted.
        </li>
        <li>
          <strong>Billing information</strong>: handled directly by Stripe; we
          do not store your card details ourselves.
        </li>
      </ul>

      <h2>How we use it</h2>
      <p>
        We use your uploaded recordings solely to generate clip suggestions for
        your review. Suggested clips are never published automatically &mdash; a
        person on your team must explicitly accept a clip, and separately,
        explicitly trigger a render and a publish. We do not use your content to
        train AI models, and we do not sell your data.
      </p>

      <h2>Third-party service providers</h2>
      <p>
        We rely on the following providers to run SceneStealer. Each only
        receives the data it needs to perform its specific function:
      </p>
      <ul>
        <li>
          <strong>Clerk</strong> &mdash; authentication and organization
          membership.
        </li>
        <li>
          <strong>Neon</strong> &mdash; our Postgres database (tenant, video,
          and clip records).
        </li>
        <li>
          <strong>Cloudflare</strong> (R2, Workers, Pages) &mdash; file storage
          and application hosting.
        </li>
        <li>
          <strong>Fly.io</strong> &mdash; runs the video-processing jobs
          (transcription, scene detection, rendering).
        </li>
        <li>
          <strong>Groq</strong> &mdash; transcribes your recording&rsquo;s audio
          track (Whisper).
        </li>
        <li>
          <strong>Anthropic</strong> &mdash; scores transcript/scene data to
          suggest which moments make good clips.
        </li>
        <li>
          <strong>Stripe</strong> &mdash; billing.
        </li>
        <li>
          <strong>Postiz</strong> (self-hosted by us) &mdash; publishes your
          accepted clips to the platforms you&rsquo;ve connected.
        </li>
      </ul>

      <h2>Instagram and Facebook data specifically</h2>
      <p>
        If you connect an Instagram or Facebook account, we request only the
        permissions needed to publish content on your behalf to a Page or
        Instagram professional account you explicitly choose: listing the
        Pages/accounts you manage, and publishing a video you&rsquo;ve approved.
        We do not request or access your personal messages, contacts, friends
        list, or any content beyond what&rsquo;s needed to publish the clips you
        approve. We do not post anything to your connected accounts unless
        you&rsquo;ve explicitly triggered that publish action in SceneStealer.
      </p>
      <p>
        You can disconnect a connected account at any time from within
        SceneStealer, which revokes our access token immediately. You can also
        revoke access directly from your Meta account&rsquo;s settings.
      </p>

      <h2>Data retention and deletion</h2>
      <p>
        We retain your uploaded recordings and generated clips for as long as
        your account is active, so you can continue to review and publish from
        them. If you close your account or ask us to delete your data, contact
        us at{" "}
        <a href="mailto:support@scenestealer.app">support@scenestealer.app</a>{" "}
        and we will delete your stored recordings, clips, and connected platform
        tokens.
      </p>

      <h2>Data security</h2>
      <p>
        Data is encrypted in transit (TLS) and at rest by our infrastructure
        providers. Access to production data is limited to the people who
        operate the service.
      </p>

      <h2>Children&rsquo;s privacy</h2>
      <p>
        SceneStealer is a business tool and is not directed at, or knowingly
        used by, children under 13.
      </p>

      <h2>Changes to this policy</h2>
      <p>
        If we make material changes to this policy, we&rsquo;ll update the date
        at the top of this page.
      </p>

      <h2>Contact us</h2>
      <p>
        Questions about this policy or your data:{" "}
        <a href="mailto:support@scenestealer.app">support@scenestealer.app</a>.
      </p>
    </main>
  );
}
