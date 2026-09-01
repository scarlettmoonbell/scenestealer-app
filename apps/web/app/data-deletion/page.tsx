import { Brand } from "../brand-name";

export const metadata = {
  title: "Data Deletion Instructions — SceneStealer",
};

// Public, unauthenticated route — Meta's App Dashboard requires either a
// dedicated Data Deletion Instructions URL or a programmatic callback
// URL; this is the URL version. Same reasoning as ../privacy/page.tsx
// and ../terms/page.tsx.
export default function DataDeletionPage() {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "2rem 1rem" }}>
      <h1>Data Deletion Instructions</h1>
      <p>
        <em>Last updated: 2026-09-01</em>
      </p>

      <p>
        You can request deletion of your data from <Brand /> at any time.
      </p>

      <h2>How to request deletion</h2>
      <p>
        Email{" "}
        <a href="mailto:support@scenestealer.app">support@scenestealer.app</a>{" "}
        from the address associated with your account and ask us to delete your
        data. Include your organization name so we can find the right account
        quickly.
      </p>

      <h2>What gets deleted</h2>
      <ul>
        <li>
          Your uploaded show recordings and any rendered clips generated from
          them.
        </li>
        <li>
          Transcripts, scene/highlight analysis, and clip metadata tied to your
          account.
        </li>
        <li>
          Access tokens for any platform you&rsquo;ve connected (YouTube,
          Instagram, Facebook) &mdash; deleting these immediately revokes our
          access to those accounts.
        </li>
        <li>Your account and organization membership records.</li>
      </ul>
      <p>
        Deletion is permanent. We typically complete a deletion request within a
        few business days and will confirm by email once it&rsquo;s done.
      </p>

      <h2>Disconnecting a platform without deleting everything</h2>
      <p>
        If you only want to revoke our access to a connected Instagram or
        Facebook account &mdash; without deleting your other <Brand /> data
        &mdash; you can disconnect it from within <Brand />, or revoke access
        directly from your Meta account&rsquo;s settings. Either way takes
        effect immediately.
      </p>

      <h2>Related</h2>
      <p>
        See our <a href="/privacy">Privacy Policy</a> for more on what we
        collect and how it&rsquo;s used.
      </p>
    </main>
  );
}
