import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
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
    // Railway, Neon, Supabase and most hosted Postgres terminate TLS with
    // their own chain.
    ssl: url.includes("localhost") || url.includes("127.0.0.1")
      ? false
      : { rejectUnauthorized: false },
  });
}

let instance: NodePgDatabase<typeof schema> | undefined;

/**
 * Built on first query, never at import time.
 *
 * `next build` imports every route module to collect its configuration, so a
 * pool created at module scope makes the build itself require a reachable
 * DATABASE_URL — which is why a clean deploy failed with "DATABASE_URL is not
 * set" while a local build passed on the strength of a .env file. Nothing here
 * is needed to compile a page; it is needed to serve one.
 */
function getDb(): NodePgDatabase<typeof schema> {
  if (instance) return instance;
  // Reuse one pool across dev hot reloads.
  const pool = globalThis.__crmPool ?? createPool();
  if (process.env.NODE_ENV !== "production") globalThis.__crmPool = pool;
  instance = drizzle(pool, { schema, casing: "snake_case" });
  return instance;
}

/**
 * Reads exactly like a Drizzle instance at every call site. The proxy exists
 * only so that touching `db` is what connects, rather than importing it.
 */
export const db = new Proxy({} as NodePgDatabase<typeof schema>, {
  get(_target, prop) {
    const real = getDb() as unknown as Record<string | symbol, unknown>;
    const value = real[prop];
    return typeof value === "function" ? value.bind(real) : value;
  },
});

export { schema };
