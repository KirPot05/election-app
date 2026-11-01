import { existsSync } from "node:fs";
import { assertDisposableDatabase } from "../../scripts/lib/db-safety";
import { runMigrations } from "../../src/server/db/migrate";

/** Applies migrations to the isolated test database once per run. */
export default async function setup() {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const url = assertDisposableDatabase(process.env.TEST_DATABASE_URL);
  await runMigrations(url);
}
