import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // Set via `.env` locally (gitignored) — Neon connection string.
    url: process.env.DATABASE_URL!,
  },
});
