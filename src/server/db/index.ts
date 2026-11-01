import { attachDatabasePool } from "@vercel/functions";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

/**
 * PostgreSQL access through node-postgres over TCP.
 *
 * This is the connection method Neon recommends for Vercel Functions (Fluid
 * compute). Unlike Neon's HTTP driver it supports interactive transactions and
 * row locks (SELECT ... FOR UPDATE / FOR SHARE), which ballot submission
 * depends on. Use Neon's *pooled* connection string in production.
 */
export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

export function createDb(connectionString: string, max = 10) {
  const pool = new Pool({
    connectionString,
    max,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });
  // A broken idle connection must not crash the process.
  pool.on("error", (err) => console.error("[db] idle client error:", err.message));
  const db = drizzle(pool, { schema });
  return { pool, db };
}

const globalForDb = globalThis as unknown as {
  __electionDb?: ReturnType<typeof createDb>;
};

/** Lazily-created, process-wide database handle. */
export function getDb(): Db {
  if (!globalForDb.__electionDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    globalForDb.__electionDb = createDb(url, Number(process.env.DB_POOL_MAX) || 10);
    if (process.env.VERCEL) {
      // Lets Vercel close idle connections before an instance is suspended.
      attachDatabasePool(globalForDb.__electionDb.pool);
    }
  }
  return globalForDb.__electionDb.db;
}

export { schema };
