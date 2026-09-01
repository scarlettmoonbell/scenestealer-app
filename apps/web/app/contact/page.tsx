export const metadata = {
  title: "Contact — SceneStealer",
};

export default function ContactPage() {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "2rem 1rem" }}>
      <h1>Contact</h1>
      <p style={{ marginTop: "1rem" }}>
        Have a question, feedback, or need help with your account?
      </p>
      <p style={{ marginTop: "1rem" }}>
        Email us at{" "}
        <a href="mailto:support@scenestealer.app">support@scenestealer.app</a>{" "}
        &mdash; we typically respond within a business day or two.
      </p>
    </main>
  );
}
