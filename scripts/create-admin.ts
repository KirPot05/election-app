/**
 * npm run admin:create [-- --username <name>] [--reset-password] [--election-name "<name>"]
 *
 * Controlled bootstrap of administrator accounts (there is no web sign-up for
 * admins). Reads ADMIN_USERNAME / ADMIN_PASSWORD from the environment, or
 * prompts for them (the password is not echoed). Also creates the election
 * row in DRAFT if none exists yet, so students can start registering.
 *
 * Works against any DATABASE_URL, including production (Neon).
 */
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { createDb } from "../src/server/db";
import { upsertAdmin } from "../src/server/services/admin";
import { createElection, getElection } from "../src/server/services/election";
import { AppError } from "../src/server/errors";
import { loadEnv } from "./env";

loadEnv();

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function prompt(question: string, hidden = false): Promise<string> {
  let muted = false;
  const output = new Writable({
    write(chunk, _enc, cb) {
      if (!muted) process.stdout.write(chunk);
      cb();
    },
  });
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(answer);
    });
    muted = hidden;
  });
}

async function main() {
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) throw new Error("Set DATABASE_URL first.");

  const username = arg("username") ?? process.env.ADMIN_USERNAME ?? (await prompt("Admin username: "));
  let password = process.env.ADMIN_PASSWORD;
  if (!password) {
    password = await prompt("Admin password (min 12 characters): ", true);
    const again = await prompt("Repeat password: ", true);
    if (password !== again) throw new Error("Passwords do not match.");
  }

  const { db, pool } = createDb(url, 2);
  try {
    const result = await upsertAdmin(db, { username, password }, { resetIfExists: process.argv.includes("--reset-password") });
    console.log(result.created ? `Created administrator "${username.trim().toLowerCase()}".` : `Password reset for "${username.trim().toLowerCase()}".`);

    if (!(await getElection(db))) {
      const name = arg("election-name") ?? "College Election";
      await createElection(db, { adminId: result.id }, { name, maxSelections: 1 });
      console.log(`Created election "${name}" in DRAFT. Configure it at /admin/election.`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  if (err instanceof AppError) {
    console.error(err.fields ? Object.values(err.fields).join(" ") : err.message);
    if (err.code === "ADMIN_EXISTS") console.error("Use --reset-password to change that administrator's password.");
  } else {
    console.error(err instanceof Error ? err.message : err);
  }
  process.exit(1);
});
