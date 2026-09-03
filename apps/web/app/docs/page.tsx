import Link from "next/link";
import { Brand } from "../brand-name";

export const metadata = {
  title: "Documentation — SceneStealer",
};

export default function DocsPage() {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "2rem 1rem" }}>
      <h1>Documentation</h1>
      <p style={{ marginTop: "1rem" }}>
        How to connect your social accounts and set up caption templates in{" "}
        <Brand />.
      </p>

      <h2 id="connecting-accounts" style={{ marginTop: "2rem" }}>
        Connecting your social accounts
      </h2>
      <p style={{ marginTop: "1rem" }}>
        Before you can publish a clip, connect the account you want to publish
        to from the <Link href="/connections">Connected Accounts</Link> tab.
        YouTube, Facebook, and Instagram are all supported.
      </p>
      <ol style={{ marginTop: "1rem" }}>
        <li>
          Open <strong>Connected Accounts</strong> and click{" "}
          <strong>Connect</strong> next to the platform you want.
        </li>
        <li>
          A new tab opens where you sign in and authorize <Brand /> on that
          platform&rsquo;s own site &mdash; your credentials never pass through{" "}
          <Brand /> itself.
        </li>
        <li>
          Once you&rsquo;ve finished authorizing, come back to the <Brand />{" "}
          tab. It checks automatically for up to two minutes and adds the new
          connection to your list once it sees it &mdash; no need to refresh.
        </li>
      </ol>
      <p style={{ marginTop: "1rem" }}>
        <strong>Instagram needs a Professional account.</strong> This is a
        platform requirement, not something specific to <Brand /> &mdash;
        Instagram&rsquo;s publishing API only works with Business or Creator
        accounts, linked to a Facebook Page. Switching is free and takes under a
        minute: open Instagram, go to Settings &rarr; Account type and tools
        &rarr; Switch to professional account, choose Creator, then link it to
        your Facebook Page when prompted.
      </p>
      <p style={{ marginTop: "1rem" }}>
        <strong>
          Already have a Professional account but the connection still fails?
        </strong>{" "}
        Having a Professional account isn&rsquo;t enough on its own &mdash; it
        has to be linked to the <em>same</em> Facebook Page you connect to{" "}
        <Brand />, and both need to sit in the same Meta Business Portfolio. If
        you see an error like &ldquo;We couldn&rsquo;t find any business
        connected to the selected pages,&rdquo; that link is missing, or the two
        are in different portfolios. Fix it from the Instagram app: your profile
        &rarr; Edit profile &rarr; Public business information (Business
        accounts) or Profile information (Creator accounts) &rarr; Page &rarr;
        Connect or create, then choose the Facebook Page you use with <Brand />.
        Once it&rsquo;s linked, try <strong>Connect Instagram</strong> again
        &mdash; you may need to remove a failed attempt first if one is still
        listed as connected.
      </p>
      <p style={{ marginTop: "1rem" }}>
        Disconnecting an account (from the same page) revokes <Brand />
        &rsquo;s access immediately &mdash; it doesn&rsquo;t just stop us from
        using it, it actually invalidates our access on the platform&rsquo;s
        side. Once an account is connected, there&rsquo;s nothing more to manage
        there day-to-day.
      </p>

      <h2 id="templating" style={{ marginTop: "2rem" }}>
        How caption templates work
      </h2>
      <p style={{ marginTop: "1rem" }}>
        A template is a caption you write once, with variables in it that get
        filled in automatically each time you use it &mdash; so you're not
        retyping the same structure (and hashtags) for every clip.
      </p>
      <ol style={{ marginTop: "1rem" }}>
        <li>
          Go to <Link href="/templates">Caption Templates</Link> and create one:
          give it a name, optionally restrict it to one platform, and write the
          caption. Drop in variables like <code>{"{{video_title}}"}</code> or{" "}
          <code>{"{{venue}}"}</code> anywhere you want them filled in.
        </li>
        <li>
          When you publish a clip, pick a template from the dropdown. Your
          caption is generated immediately, with every variable substituted
          &mdash; you can still edit it by hand before you hit Publish.
        </li>
        <li>
          A template scoped to one platform only shows up when you&rsquo;re
          publishing to that platform; leave the platform set to &ldquo;Any
          platform&rdquo; to make it available everywhere.
        </li>
      </ol>
      <p style={{ marginTop: "1rem" }}>
        Not every clip has every variable available &mdash; a screen recording,
        for instance, has no device or location metadata. A variable with
        nothing to fill just gets quietly dropped from the caption rather than
        left in literally. See the full list of available variables, with
        examples, on the <Link href="/templates">Caption Templates</Link> page.
      </p>

      <h2 style={{ marginTop: "2rem" }}>Get in touch</h2>
      <p style={{ marginTop: "1rem" }}>
        Something not covered here? <Link href="/contact">Contact us</Link>.
      </p>
    </main>
  );
}
