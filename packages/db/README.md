# @scenestealer/db

Drizzle ORM schema + migrations (Neon Postgres), shared by `apps/api` and
`apps/worker`. App-specific — not reusable outside this product, unlike
`scenestealer-connectors`/`scenestealer-pipeline`.

**One deliberate deviation from `PLAN.md`'s data model list:** no separate
`Membership` table. Clerk Organizations already own membership/roles (who
belongs to which tenant, what role they hold) via its own API and UI —
duplicating that into a table here would just be a second, driftable source
of truth. `tenants.clerkOrgId` is the join point back to Clerk.

## Status

Phase 1 scaffold — schema is real and typechecks; no migrations generated
yet (`db:generate` hasn't been run against a live Neon database).
