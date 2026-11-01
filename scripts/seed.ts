/**
 * npm run db:seed [-- --reset]
 *
 * DEVELOPMENT ONLY. Loads deterministic fictional data into DATABASE_URL:
 *   - "College Election 2026" in DRAFT, 12 candidates, M = 5
 *   - 20 students DEV2026001..DEV2026020 (passwords student-pass-001..020)
 *   - administrator "admin" / "dev-admin-password"
 * Refuses to run in production, and refuses to touch a non-empty database
 * unless --reset is given (which deletes ALL data in that database).
 */
import { count } from "drizzle-orm";
import { createDb } from "../src/server/db";
import { voters, elections } from "../src/server/db/schema";
import { signup } from "../src/server/services/voters";
import { isProductionEnv, loadEnv } from "./env";
import { DEV_ADMIN, SAMPLE_CANDIDATES, SAMPLE_STUDENTS, seedAdmin, seedElection, truncateAll } from "./lib/fixtures";

loadEnv();

async function main() {
  if (isProductionEnv()) {
    throw new Error("Refusing to seed: this looks like a production environment (APP_ENV/VERCEL_ENV/NODE_ENV).");
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  const reset = process.argv.includes("--reset");

  const { db, pool } = createDb(url, 4);
  try {
    const [[{ e }], [{ v }]] = await Promise.all([
      db.select({ e: count() }).from(elections),
      db.select({ v: count() }).from(voters),
    ]);
    if ((e > 0 || v > 0) && !reset) {
      throw new Error("The database already contains data. Re-run with --reset to wipe it and reseed.");
    }
    if (reset) await truncateAll(db);

    await seedAdmin(db, DEV_ADMIN);
    await seedElection(db);
    for (const [i, s] of SAMPLE_STUDENTS.entries()) {
      await signup(db, s, { ip: `seed-${i}` });
    }
    console.log("Seeded development data:");
    console.log(`  Election: College Election 2026 (DRAFT), ${SAMPLE_CANDIDATES.length} candidates, max 5 selections`);
    console.log(`  Admin:    ${DEV_ADMIN.username} / ${DEV_ADMIN.password}   ->  /admin/login`);
    console.log(`  Students: ${SAMPLE_STUDENTS[0].registrationNumber} / ${SAMPLE_STUDENTS[0].password} ... ${SAMPLE_STUDENTS.at(-1)!.registrationNumber} / ${SAMPLE_STUDENTS.at(-1)!.password}`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
