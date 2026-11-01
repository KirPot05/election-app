/**
 * npm run db:cleanup
 *
 * Run AFTER the election is FINALIZED and results have been exported.
 * Deletes data that is no longer needed: all login sessions (everyone is
 * signed out), password-recovery tokens and rate-limit counters.
 * Keeps the election, candidates, anonymous ballots, participation records
 * and the audit log, so results stay verifiable.
 *
 * For full teardown (deleting all personal data), export what you need and
 * then delete the Neon project/database. See README "Post-election data
 * retention and teardown".
 */
import { sql } from "drizzle-orm";
import { createDb } from "../src/server/db";
import { getElection } from "../src/server/services/election";
import { loadEnv } from "./env";

loadEnv();

async function main() {
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) throw new Error("Set DATABASE_URL first.");
  const { db, pool } = createDb(url, 1);
  try {
    const election = await getElection(db);
    if (election?.status !== "FINALIZED") {
      throw new Error("Refusing to clean up: the election must be FINALIZED first.");
    }
    await db.execute(sql`TRUNCATE sessions, recovery_tokens, rate_limits`);
    console.log("Deleted all sessions, recovery tokens and rate-limit counters.");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
