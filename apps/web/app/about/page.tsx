import { Brand } from "../brand-name";

export const metadata = {
  title: "About — SceneStealer",
};

export default function AboutPage() {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "2rem 1rem" }}>
      <h1>
        About <Brand />
      </h1>
      <p style={{ marginTop: "1rem" }}>
        <Brand /> turns full-length live-performance recordings into short,
        share-ready highlight clips.
      </p>

      <h2 style={{ marginTop: "2rem" }}>What we do</h2>
      <p style={{ marginTop: "1rem" }}>
        Upload a full recording of a show, concert, or performance. <Brand />{" "}
        automatically finds the moments worth sharing &mdash; scene changes,
        audience reactions, standout beats &mdash; and gets them ready to
        publish. Review the suggestions, approve the ones you want, and publish
        straight to YouTube, Instagram, and Facebook.
      </p>

      <h2 style={{ marginTop: "2rem" }}>Who it&rsquo;s for</h2>
      <p style={{ marginTop: "1rem" }}>
        Theater companies, dance companies, concert venues, comedy clubs &mdash;
        any organization that records live performances and wants an easier way
        to share the best of them on social media, without hiring an editor or
        learning one.
      </p>

      <h2 style={{ marginTop: "2rem" }}>Who&rsquo;s behind it</h2>
      <p style={{ marginTop: "1rem" }}>
        <Brand /> was founded by Scarlett Bell, an improviser and director from
        Austin, TX with a determination to remove toil and automate everything.
        The goal from day one: make this process easy &mdash; and maybe even a
        little fun.
      </p>

      <h2 style={{ marginTop: "2rem" }}>Get in touch</h2>
      <p style={{ marginTop: "1rem" }}>
        Questions, feedback, or just want to say hello?{" "}
        <a href="/contact">Contact us</a>.
      </p>
    </main>
  );
}
