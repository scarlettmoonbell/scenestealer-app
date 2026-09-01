export const metadata = {
  title: "Terms of Service — SceneStealer",
};

// Public, unauthenticated route — same reasoning as ./privacy/page.tsx.
// The governing-law section below has a placeholder pending real legal
// review; see ROADMAP.md.
export default function TermsOfServicePage() {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "2rem 1rem" }}>
      <h1>Terms of Service</h1>
      <p>
        <em>Last updated: 2026-08-25</em>
      </p>

      <p>
        These terms govern your use of SceneStealer. By creating an organization
        or using the service, you agree to them on behalf of yourself and, if
        applicable, the organization you represent.
      </p>

      <h2>The service</h2>
      <p>
        SceneStealer lets you upload full-length recordings, review AI-suggested
        highlight clips, accept or reject them, render accepted clips for
        specific platforms, and publish them to social and video platforms you
        choose to connect.
      </p>

      <h2>Accounts</h2>
      <p>
        Accounts are organized by tenant (typically one per live-performance
        organization). You&rsquo;re responsible for the people you invite into
        your organization and for keeping your account credentials secure.
      </p>

      <h2>Your content</h2>
      <p>
        You retain ownership of everything you upload. By uploading a recording,
        you grant us a license to store, process, and (only once you&rsquo;ve
        explicitly accepted a clip and triggered publishing) transmit it to the
        platforms you&rsquo;ve connected, solely to provide the service to you.
        You&rsquo;re responsible for having the rights to everything you upload
        and everything you choose to publish.
      </p>

      <h2>Acceptable use</h2>
      <p>You agree not to use SceneStealer to:</p>
      <ul>
        <li>Upload or publish content you don&rsquo;t have the rights to.</li>
        <li>
          Violate the terms of any third-party platform you connect through
          SceneStealer (YouTube, Instagram, Facebook, and others as
          they&rsquo;re added).
        </li>
        <li>
          Attempt to disrupt, reverse-engineer, or gain unauthorized access to
          the service.
        </li>
      </ul>

      <h2>Connected platforms</h2>
      <p>
        When you connect a platform like YouTube, Instagram, or Facebook,
        you&rsquo;re also agreeing to that platform&rsquo;s own terms of
        service. We publish to a connected platform only when you explicitly
        trigger a publish action for a specific clip &mdash; nothing is
        published automatically. You can disconnect a platform at any time,
        which revokes our access to it.
      </p>

      <h2>Billing</h2>
      <p>
        Paid plans, when available, are billed through Stripe. Pricing and
        billing terms will be presented at signup for a paid plan.
      </p>

      <h2>Disclaimers</h2>
      <p>
        SceneStealer is provided &ldquo;as is.&rdquo; AI-generated clip
        suggestions are exactly that &mdash; suggestions for your review, not
        guaranteed to be accurate or complete. You&rsquo;re responsible for
        reviewing any clip before accepting or publishing it.
      </p>

      <h2>Limitation of liability</h2>
      <p>
        To the extent permitted by law, SceneStealer is not liable for indirect,
        incidental, or consequential damages arising from your use of the
        service.
      </p>

      <h2>Termination</h2>
      <p>
        You can stop using the service and close your account at any time. We
        may suspend or terminate an account that violates these terms.
      </p>

      <h2>Changes to these terms</h2>
      <p>
        If we make material changes, we&rsquo;ll update the date at the top of
        this page.
      </p>

      <h2>Governing law</h2>
      <p>
        <em>
          [Placeholder &mdash; pending a real legal read, same as this
          project&rsquo;s software license. See ROADMAP.md.]
        </em>
      </p>

      <h2>Contact us</h2>
      <p>
        Questions about these terms:{" "}
        <a href="mailto:support@scenestealer.app">support@scenestealer.app</a>.
      </p>
    </main>
  );
}
