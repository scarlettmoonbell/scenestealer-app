import { auth } from "@clerk/nextjs/server";
import {
  CreateOrganization,
  OrganizationSwitcher,
  SignedIn,
  SignedOut,
  SignIn,
  UserButton,
} from "@clerk/nextjs";
import { eq } from "drizzle-orm";
import { createDb, tenants } from "@scenestealer/db";
import { UploadPanel } from "./upload-panel";
import { VideoList } from "./video-list";

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
      <h1>SceneStealer</h1>

      <SignedOut>
        <SignIn />
      </SignedOut>

      <SignedIn>
        <header
          style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
        >
          <OrganizationSwitcher hidePersonal />
          <UserButton />
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
      </SignedIn>
    </main>
  );
}
