/**
 * npm run db:migrate
 *
 * Applies pending migrations to DATABASE_URL_UNPOOLED (preferred for Neon) or
 * DATABASE_URL. Safe to run repeatedly. Never drops data.
 */
import { loadEnv } from "./env";
import { runMigrations } from "../src/server/db/migrate";

loadEnv();
const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  console.error("Set DATABASE_URL (or DATABASE_URL_UNPOOLED) first.");
  process.exit(1);
}

runMigrations(url)
  .then(() => {
    console.log(`Migrations applied to ${redact(url)}`);
  })
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });

function redact(u: string) {
  try {
    const parsed = new URL(u);
    return `${parsed.hostname}${parsed.pathname}`;
  } catch {
    return "(database)";
  }
}
