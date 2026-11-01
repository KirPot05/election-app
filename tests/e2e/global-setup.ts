import { assertDisposableDatabase } from "../../scripts/lib/db-safety";
import { runMigrations } from "../../src/server/db/migrate";

/** Migrates the isolated E2E database before the suite runs. */
export default async function globalSetup() {
  await runMigrations(assertDisposableDatabase(process.env.E2E_DATABASE_URL));
}
