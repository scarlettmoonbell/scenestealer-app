import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Minimal config — this app doesn't use ISR/on-demand revalidation
// (every route is `force-dynamic`, see app/layout.tsx), so no
// incremental-cache KV/R2 setup is needed.
export default defineCloudflareConfig();
