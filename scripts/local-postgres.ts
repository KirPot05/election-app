/**
 * Starts a real PostgreSQL server for local development and testing, without
 * Docker. Uses the `embedded-postgres` package, which ships official
 * PostgreSQL binaries. Data lives in ./.pgdata (git-ignored).
 *
 *   npm run db:local        # keep running in its own terminal
 *
 * Creates the databases `election_dev`, `election_test` and `election_e2e`.
 * If you already run PostgreSQL (Docker, Postgres.app, a system service),
 * you don't need this; point the *_DATABASE_URL variables at your server.
 */
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
import path from "node:path";

const port = Number(process.env.LOCAL_PG_PORT ?? 54329);
const databaseDir = path.resolve(".pgdata");
const databases = ["election_dev", "election_test", "election_e2e"];

async function main() {
  const pg = new EmbeddedPostgres({
    databaseDir,
    user: "postgres",
    password: "postgres",
    port,
    persistent: true,
    onLog: () => {},
  });

  if (!existsSync(path.join(databaseDir, "PG_VERSION"))) {
    console.log("Initialising PostgreSQL cluster in .pgdata ...");
    await pg.initialise();
  }
  await pg.start();

  const client = pg.getPgClient();
  await client.connect();
  const { rows } = await client.query<{ datname: string }>(
    "SELECT datname FROM pg_database",
  );
  await client.end();
  const existing = new Set(rows.map((r) => r.datname));
  for (const db of databases) {
    if (!existing.has(db)) await pg.createDatabase(db);
  }

  console.log(`PostgreSQL running on port ${port}. Databases:`);
  for (const db of databases) {
    console.log(`  postgres://postgres:postgres@localhost:${port}/${db}`);
  }
  console.log("Press Ctrl+C to stop.");

  const shutdown = async () => {
    await pg.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  // Keep the process alive.
  setInterval(() => {}, 1 << 30);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
