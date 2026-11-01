/**
 * npm run db:reset:test
 *
 * Drops and recreates the schema of the TEST and E2E databases, then applies
 * all migrations. Refuses to touch any database whose name does not contain
 * "test" or "e2e".
 */
import pg from "pg";
import { assertDisposableDatabase } from "./lib/db-safety";
import { loadEnv } from "./env";
import { runMigrations } from "../src/server/db/migrate";

loadEnv();

async function reset(url: string) {
  assertDisposableDatabase(url);
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("DROP SCHEMA IF EXISTS drizzle CASCADE");
    await client.query("DROP SCHEMA IF EXISTS public CASCADE");
    await client.query("CREATE SCHEMA public");
  } finally {
    await client.end();
  }
  await runMigrations(url);
  console.log(`Reset ${new URL(url).pathname.slice(1)}`);
}

async function main() {
  const urls = [process.env.TEST_DATABASE_URL, process.env.E2E_DATABASE_URL].filter(Boolean) as string[];
  if (!urls.length) throw new Error("Set TEST_DATABASE_URL and/or E2E_DATABASE_URL.");
  for (const url of urls) await reset(url);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
