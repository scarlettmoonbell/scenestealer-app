import { auth } from "@clerk/nextjs/server";
import {
  CreateOrganization,
  OrganizationSwitcher,
  Show,
  UserButton,
} from "@clerk/nextjs";
import { eq } from "drizzle-orm";
import { createDb, tenants } from "@scenestealer/db";
import { ThemedSignIn } from "./themed-sign-in";
import { UploadPanel } from "./upload-panel";
import { VideoList } from "./video-list";

const steps = [
  {
    title: "Upload your recording",
    body: "Drop in the full-length video of your show — any length, no prep needed.",
    icon: (
      <svg
        width="26"
        height="26"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 16V4" />
        <path d="M7 9l5-5 5 5" />
        <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
      </svg>
    ),
  },
  {
    title: "We find the highlights",
    body: "Scene detection and audience-reaction analysis surface the moments worth sharing.",
    icon: (
      <svg
        width="26"
        height="26"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
        <path d="M6.5 6.5l2 2M15.5 15.5l2 2M17.5 6.5l-2 2M8.5 15.5l-2 2" />
      </svg>
    ),
  },
  {
    title: "Review, then publish",
    body: "Approve the clips you want. Publish straight to your connected accounts.",
    icon: (
      <svg
        width="26"
        height="26"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M14 3h7v7" />
        <path d="M21 3l-9 9" />
        <path d="M19 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h6" />
      </svg>
    ),
  },
];

const performanceTypes = [
  "Theater",
  "Dance",
  "Concerts",
  "Comedy",
  "Live music",
];

function SignedOutLanding() {
  return (
    <>
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 1160,
            padding: "22px 24px",
            display: "flex",
            alignItems: "center",
          }}
        >
          <span
            style={{
              fontFamily: "'Bodoni Moda', Georgia, serif",
              fontSize: 22,
              fontWeight: 600,
              color: "var(--heading)",
              letterSpacing: "0.3px",
            }}
          >
            SceneStealer
          </span>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "center" }}>
        <div
          style={{
            width: "100%",
            maxWidth: 1160,
            padding: "56px 24px 80px",
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr)",
            gap: 48,
            alignItems: "center",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            <h1
              style={{
                fontSize: 42,
                lineHeight: 1.12,
                fontWeight: 500,
              }}
            >
              Your show&rsquo;s best moments, ready to share
            </h1>
            <p
              style={{
                fontSize: 18,
                lineHeight: 1.55,
                color: "var(--muted)",
                maxWidth: 520,
              }}
            >
              Upload the full recording. SceneStealer finds the highlights, you
              approve them, and they go straight to YouTube, Instagram, and
              Facebook.
            </p>
          </div>

          <div
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 14,
              padding: 28,
              maxWidth: 420,
            }}
          >
            <div style={{ marginBottom: 16 }}>
              <h3 style={{ fontSize: 20, fontWeight: 500 }}>Sign in</h3>
              <p style={{ fontSize: 14, color: "var(--muted)", marginTop: 6 }}>
                Get started with your organization
              </p>
            </div>
            <ThemedSignIn />
          </div>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "center",
          background: "var(--surface)",
        }}
      >
        <div style={{ width: "100%", maxWidth: 1160, padding: "72px 24px" }}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 10,
              marginBottom: 40,
              maxWidth: 560,
            }}
          >
            <span
              style={{
                fontSize: 13,
                fontWeight: 600,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "var(--accent-text)",
              }}
            >
              How it works
            </span>
            <h2 style={{ fontSize: 30, fontWeight: 500 }}>
              From full recording to social-ready clip
            </h2>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 32,
            }}
          >
            {steps.map((step) => (
              <div
                key={step.title}
                style={{ display: "flex", flexDirection: "column", gap: 16 }}
              >
                <div
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 10,
                    background: "var(--surface-raised)",
                    border: "1px solid var(--border)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "var(--accent-text)",
                  }}
                >
                  {step.icon}
                </div>
                <h3 style={{ fontSize: 18, fontWeight: 500 }}>{step.title}</h3>
                <p
                  style={{
                    fontSize: 15,
                    lineHeight: 1.6,
                    color: "var(--muted)",
                  }}
                >
                  {step.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "center" }}>
        <div
          style={{
            width: "100%",
            maxWidth: 1160,
            padding: "72px 24px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            textAlign: "center",
            gap: 20,
          }}
        >
          <h2 style={{ fontSize: 30, fontWeight: 500, maxWidth: 620 }}>
            Built for live performance
          </h2>
          <p
            style={{
              fontSize: 16,
              lineHeight: 1.6,
              color: "var(--muted)",
              maxWidth: 560,
            }}
          >
            Theater. Dance. Concerts. Comedy. If it&rsquo;s performed live and
            recorded, SceneStealer turns it into clips worth sharing.
          </p>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 12,
              justifyContent: "center",
              marginTop: 4,
            }}
          >
            {performanceTypes.map((type) => (
              <span key={type} className="pill">
                {type}
              </span>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

export default async function HomePage() {
  const { orgId } = await auth();

  const tenant = orgId
    ? (
        await createDb(process.env.DATABASE_URL!)
          .select({ id: tenants.id })
          .from(tenants)
          .where(eq(tenants.clerkOrgId, orgId))
          .limit(1)
      )[0]
    : undefined;

  return (
    <main>
      <Show when="signed-out">
        <SignedOutLanding />
      </Show>

      <Show when="signed-in">
        <div style={{ maxWidth: 1160, margin: "0 auto", padding: "0 24px" }}>
          <header
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "22px 0",
            }}
          >
            <span
              style={{
                fontFamily: "'Bodoni Moda', Georgia, serif",
                fontSize: 22,
                fontWeight: 600,
                color: "var(--heading)",
              }}
            >
              SceneStealer
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <OrganizationSwitcher hidePersonal />
              <UserButton />
            </div>
          </header>

          {tenant ? (
            <>
              <UploadPanel />
              <VideoList tenantId={tenant.id} />
            </>
          ) : (
            <>
              <p>Create an organization to start uploading show recordings.</p>
              <CreateOrganization />
            </>
          )}
        </div>
      </Show>
    </main>
  );
}
