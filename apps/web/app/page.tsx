import { auth } from "@clerk/nextjs/server";
import {
  CreateOrganization,
  OrganizationSwitcher,
  Show,
  UserButton,
} from "@clerk/nextjs";
import { eq } from "drizzle-orm";
import { createDb, tenants } from "@scenestealer/db";
import { Brand } from "./brand-name";
import { LandingTabs } from "./landing-tabs";
import { SiteHeader } from "./site-header";
import { ThemedSignIn } from "./themed-sign-in";
import { UploadPanel } from "./upload-panel";
import { VideoList } from "./video-list";

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
      <SiteHeader />

      <div style={{ display: "flex", justifyContent: "center" }}>
        <div
          style={{
            width: "100%",
            maxWidth: 1160,
            padding: "56px 24px 80px",
          }}
        >
          <div className="hero-grid">
            <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
              <h1
                style={{
                  fontSize: 42,
                  lineHeight: 1.12,
                  fontWeight: 500,
                  maxWidth: 520,
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
                Upload the full recording. <Brand /> finds the highlights, you
                approve them, and they go straight to YouTube, Instagram, and
                Facebook. Apply your own caption templates and schedule each
                post for exactly when your audience is watching.
              </p>
            </div>

            <div
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 14,
                padding: 28,
                justifySelf: "end",
                width: "100%",
              }}
            >
              <div style={{ marginBottom: 16 }}>
                <h3 style={{ fontSize: 20, fontWeight: 500 }}>Sign in</h3>
                <p
                  style={{ fontSize: 14, color: "var(--muted)", marginTop: 6 }}
                >
                  Get started with your organization
                </p>
              </div>
              <ThemedSignIn />
            </div>
          </div>
        </div>
      </div>

      <LandingTabs />

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
            recorded, <Brand /> turns it into clips worth sharing.
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
        <SiteHeader
          right={
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <OrganizationSwitcher hidePersonal />
              <UserButton />
            </div>
          }
        />

        <div style={{ maxWidth: 1160, margin: "0 auto", padding: "24px" }}>
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
