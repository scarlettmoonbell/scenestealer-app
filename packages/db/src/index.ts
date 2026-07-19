import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "./schema.js";

export * from "./schema.js";

export function createDb(connectionString: string) {
  return drizzle(connectionString, { schema });
}

export type Database = ReturnType<typeof createDb>;
