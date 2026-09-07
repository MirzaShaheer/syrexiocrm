import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

declare global {
  var __crmPool: Pool | undefined;
}

function createPool() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return new Pool({
    connectionString: url,
    max: 10,
    // Railway and most hosted Postgres terminate TLS with their own chain.
    ssl: url.includes("localhost") || url.includes("127.0.0.1")
      ? false
      : { rejectUnauthorized: false },
  });
}

// Reuse one pool across dev hot reloads.
const pool = globalThis.__crmPool ?? createPool();
if (process.env.NODE_ENV !== "production") globalThis.__crmPool = pool;

export const db = drizzle(pool, { schema, casing: "snake_case" });
export { schema };
