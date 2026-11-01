# College Election

A small, mobile-first voting application for a one-time college election (fewer than 100 voters).
Students register themselves and vote from their phones. An administrator configures the election,
starts and stops voting, watches turnout and totals live, and exports the results.

- **One Next.js app** (App Router, TypeScript, React, Tailwind CSS). No separate backend, no Docker, Redis, WebSockets, email or SMS.
- **PostgreSQL** (Neon in production) via **Drizzle ORM** and `pg`.
- **Deploys on Vercel** as a standard Next.js project.
- **Tested** with Vitest (unit tests, plus integration tests against real PostgreSQL) and Playwright (mobile E2E on Chromium and WebKit).

> **Administrators:** the step-by-step operations guide is in [docs/ADMIN_GUIDE.md](docs/ADMIN_GUIDE.md).

---

## Contents

1. [How it works](#how-it-works)
2. [Architecture](#architecture)
3. [Database design](#database-design)
4. [Voting integrity and concurrency](#voting-integrity-and-concurrency)
5. [Ballot confidentiality](#ballot-confidentiality)
6. [Authentication, sessions and password recovery](#authentication-sessions-and-password-recovery)
7. [Local development](#local-development)
8. [Commands](#commands)
9. [Environment variables](#environment-variables)
10. [Testing](#testing)
11. [Deploying to Vercel + Neon](#deploying-to-vercel--neon)
12. [Real election data](#real-election-data)
13. [Exports, backups, retention and teardown](#exports-backups-retention-and-teardown)
14. [Security notes](#security-notes)
15. [Known limitations](#known-limitations)

---

## How it works

### Election rules

- One election with **K candidates**. Each student may select **1 to M distinct candidates** (`1 ≤ M < K`).
- **Approval counting.** Each selected candidate receives one vote. Totals are independent, and nothing is ranked or weighted.
  The app does not declare winners. It shows totals sorted by vote count.
- Each student can submit **exactly one ballot**. Ballots are final.
- M and the candidates are configured by the administrator before voting opens. Nothing is hard-coded.

### Lifecycle

```
DRAFT ──start──▶ OPEN ──stop──▶ CLOSED ──finalize──▶ FINALIZED
```

| State | Students | Administrator |
|---|---|---|
| DRAFT | Register, log in, change password. See the waiting screen. | Configure the name, M and results visibility. Manage candidates and eligibility. Reset passwords. |
| OPEN | Students who have not voted see the ballot. Students who have voted see a confirmation. **Registration is closed.** | Watch turnout and totals live. Reset passwords. Stop voting. |
| CLOSED | See "voting has closed". | View and export results. Reset passwords. Finalize. |
| FINALIZED | See "election complete". | Read-only results, exports and audit log. |

Transitions only move forward. The server and the database both refuse anything else, so a closed election cannot be reopened.
Every transition requires an explicit confirmation in the UI and is written to the audit log.

### Student screens

| Election | Student | Screen |
|---|---|---|
| DRAFT | registered | Waiting screen. After signup it says "Registration successful!"; on later visits it says "You're registered". |
| OPEN | not voted | Ballot, then review, then confirm |
| OPEN | voted | "You have already voted" |
| CLOSED | any | "Voting has closed" |
| FINALIZED | any | "The election is complete" |

The waiting screen checks `/api/student/status` every 7 seconds, and the student can tap **Refresh** at any time.
When the administrator opens voting, the ballot appears without logging out and back in.

---

## Architecture

```
Browser (phone)
   │  HTTPS, JSON, HttpOnly session cookie
   ▼
Next.js on Vercel (Node.js functions)
   ├─ src/app/(student)/…     student pages (server components + small client forms)
   ├─ src/app/admin/…         admin pages
   ├─ src/app/api/…           JSON route handlers (thin: parse → auth → service → response)
   ├─ src/server/services/…   business logic and transactions (tested directly)
   ├─ src/server/auth/…       Argon2id, tokens, PostgreSQL-backed sessions, cookies
   ├─ src/server/db/…         Drizzle schema, pg Pool, migrator
   └─ src/lib/…               pure, shared rules: validation, election rules, results, CSV
   │  TCP (node-postgres), interactive transactions, row locks
   ▼
PostgreSQL (Neon) — constraints and triggers enforce the rules even outside the app
```

**Technology choices**

- **Next.js 16 App Router.** `cacheComponents` is deliberately **off**. Every page reads the session cookie and live election
  state, so it renders per request, and API responses carry `Cache-Control: no-store`. Nothing can serve a stale election status.
- **`pg` (node-postgres) over TCP.** Neon recommends this for Vercel Functions. It supports **interactive transactions and
  `SELECT … FOR UPDATE/SHARE`**, which ballot submission needs. Neon's HTTP driver only supports non-interactive transactions.
  On Vercel the pool is registered with `attachDatabasePool` from `@vercel/functions`.
- **Drizzle ORM** provides typed queries and SQL migrations. One hand-written migration adds the integrity triggers.
- **Argon2id** via `@node-rs/argon2` uses prebuilt native binaries, so nothing is compiled on Vercel.
- **zod** validates input. The same schemas run in the browser for early feedback and on the server, where they are enforced.
- **No UI kit.** shadcn/ui was considered, but six small Tailwind components (`src/components/ui.tsx`) keep dependencies
  and bundle size down.

---

## Database design

| Table | Purpose |
|---|---|
| `elections` | The single election row: name, `max_selections` (M), `status`, `results_visibility`, and transition timestamps. A unique index on `(true)` allows only one row. |
| `candidates` | Candidates, with a case-insensitive unique name per election. |
| `voters` | Student accounts: full name, registration number (display form plus a unique normalized form), Argon2id hash, `eligible`. |
| `admin_users` | Administrators (created only by CLI). |
| `sessions` | Server-side sessions. The `id` is SHA-256 of the cookie token. Each session belongs to a voter or an admin (check constraint). |
| `voter_participation` | **Who voted.** Primary key `(election_id, voter_id)`, so at most one row per voter. Holds the submission key (for idempotency). No timestamp. |
| `ballots` | **Anonymous ballots.** A random UUID and `election_id` only: no voter reference, no timestamp. |
| `ballot_choices` | `(ballot_id, candidate_id)` primary key, so a candidate appears at most once per ballot. Composite foreign keys ensure the ballot and the candidate belong to the same election. |
| `recovery_tokens` | SHA-256 of single-use password-recovery tokens, with expiry, used and revoked timestamps. |
| `audit_events` | Administrative actions. Never contains ballot contents, passwords or tokens. |
| `rate_limits` | Fixed-window counters keyed by a SHA-256 of the key, so raw IPs are not stored. |

**Database-enforced rules** (in `drizzle/0001_integrity_triggers.sql`, in addition to the application checks):

- Status changes only follow DRAFT→OPEN→CLOSED→FINALIZED. Opening requires `1 ≤ M < K`.
- The name, M and visibility are locked after DRAFT. Candidates can only be inserted, updated or deleted in DRAFT.
- Ballots and participation can only be inserted while OPEN. Choices can only be added in the same transaction that created the ballot.
- Votes are append-only: `UPDATE` and `DELETE` on ballots, choices and participation are rejected.
- At commit, every ballot must have between 1 and M choices, and the number of ballots must equal the number of participation rows.
- Registration numbers can never change, and eligibility can only change before voting opens.

---

## Voting integrity and concurrency

Ballot submission (`src/server/services/ballot.ts`) is a single READ COMMITTED transaction:

1. `SELECT … FROM elections FOR SHARE`: concurrent ballots share this lock.
2. `SELECT … FROM voters WHERE id = $voter FOR UPDATE`: this serializes all submissions by the same voter (double taps, tabs, devices, retries).
3. If a participation row exists: the **same submission key** returns `ALREADY_RECORDED` (an idempotent retry); any other key returns `409 ALREADY_VOTED`.
4. Check that the election is OPEN, the voter is eligible, and the selection is 1..M distinct valid candidates.
5. Insert the participation row, then the anonymous ballot, then its choices.
6. COMMIT. Deferred triggers re-check ballot size and parity. If anything fails, everything rolls back.

**Closing versus voting.** Closing runs `UPDATE elections SET status='CLOSED'`, which needs an exclusive row lock and so waits for
every in-flight ballot holding `FOR SHARE`. Ballots that arrive after the close starts wait for it to finish, then see `CLOSED`
and are rejected. A ballot is therefore either fully counted before the close or rejected; it is never half-written.

**Lock order** everywhere: election row, then voter row, then inserts. Signup and candidate edits also take the election row
`FOR SHARE`, so they cannot race the DRAFT→OPEN transition.

**Network uncertainty.** The client generates one submission key (UUID) per reviewed ballot and reuses it on retry.
If the connection drops, the UI never suggests voting again. It asks `/api/student/status` whether the vote was recorded
and shows the confirmed outcome.

These guarantees are verified against real PostgreSQL in `tests/integration/concurrency.test.ts`, which covers 12 simultaneous
submissions by one student, 20 different students voting at once, a close held open while a ballot waits, a stress race
between closing and voting, and concurrent signups with the same registration number.

---

## Ballot confidentiality

The app keeps identity and ballot contents apart at the application level:

- `voters`/`voter_participation` and `ballots`/`ballot_choices` share **no key, foreign key, timestamp or sequence**.
  Ballot ids are random UUIDs. Ballots and participation rows have no timestamps, and casting a vote is not audited.
- No endpoint, page or export returns an individual ballot. Admins see only aggregates and who has voted.
- The server never logs ballot contents. Unexpected errors are logged with their error code only, because driver error messages can contain query parameters.
- Students never see totals.

**Residual risks (be honest about these):**

- **Live totals inference.** If the admin watches totals while only one person votes between two refreshes, the change in the
  totals reveals that person's choices. To reduce this, set **"Hide totals until voting closes"** in Election settings. Turnout stays live.
- **Database-level access.** Anyone with direct database access, such as the Neon project owner, could try to correlate
  rows using physical storage order or write-ahead-log timing. This is application-level separation, **not** cryptographically verifiable anonymity.
- Very small elections make inference easier in general. For example, if everyone votes the same way, everyone's choice is known.

---

## Authentication, sessions and password recovery

- **Signup** collects only full name, college registration number and password.
  - The name is trimmed with whitespace collapsed. Unicode letters, spaces, apostrophes, hyphens and periods are allowed, up to 100 characters.
  - The registration number is stored as text. The **normalized** form (NFKC, all whitespace removed, upper-cased) must be unique,
    so leading zeros and characters such as `/` or `-` are preserved. The default format is 3–32 characters of `A-Z 0-9 / . _ -`,
    configurable with `REGISTRATION_NUMBER_PATTERN`.
  - The password must be at least 8 characters (up to 256), with no composition rules. It is stored as Argon2id (m=19 MiB, t=2, p=1).
  - Signup is atomic: a PostgreSQL unique constraint handles duplicates, including concurrent ones, and the election row lock
    stops signups once voting opens. On success, the student is logged in and sent to the waiting screen.
- **Identity limitation:** a unique registration number stops two accounts using the same number, but **does not prove the
  person registering owns that number**. That is accepted for this election. If a student finds their number already taken,
  the administrator can investigate and revoke that account's eligibility before voting opens.
- **Sessions:** a 256-bit random token in an `HttpOnly` cookie. The database stores only its SHA-256.
  Cookies are `Secure` with the `__Host-` prefix in production. The student cookie is `SameSite=Lax` and the admin cookie is `SameSite=Strict`.
  Lifetimes are 7 days for students and 12 hours for admins (configurable). Sessions survive refreshes and browser restarts.
  Logout deletes the session server-side.
- **Brute force:** at most 10 failed logins per registration number per 15 minutes; 200 login attempts and 150 signups per IP per window (campus networks share IPs);
  at most 5 failed admin logins per username. All errors are generic ("Incorrect registration number or password.").
- **Password change** (`/account`): requires the current password. It revokes all other sessions and rotates the current one.
- **Admin-assisted recovery:**
  1. The admin verifies the student's identity in person, then taps **Reset password** on the Students page.
  2. The server creates a 256-bit single-use token, valid for 15 minutes, and stores only its hash. **Policy:** all of the student's sessions
     are revoked immediately, and any earlier unused token is invalidated.
  3. The admin sees the link `https://…/reset-password#<token>` **once** and gives it to the student privately.
     The token is in the URL fragment, which browsers never send to servers, so it does not appear in logs.
  4. The student sets a new password. The token is marked used and all sessions are revoked again. The student then logs in.
  5. Recovery never touches participation, ballots, totals or the registration number. A student who has voted stays "voted".
  Issuing and completing recovery are both audited, without the token.

---

## Local development

Requirements: **Node.js 22+** and **PostgreSQL 14+**. If you don't have PostgreSQL, the repo includes a Docker-free launcher.

```bash
npm install
cp .env.example .env.local          # defaults point at the local launcher below

# Terminal 1: a real PostgreSQL 17 on port 54329 (data in ./.pgdata), no Docker needed
npm run db:local

# Terminal 2
npm run db:migrate                  # apply migrations to DATABASE_URL
npm run db:seed                     # fictional dev data (see below)
npm run dev                         # http://localhost:3000
```

Development seed (never use in production):

- Election "College Election 2026" in DRAFT, 12 candidates, M = 5
- Students `DEV2026001` … `DEV2026020`, passwords `student-pass-001` … `student-pass-020`
- Admin `admin` / `dev-admin-password` at `/admin/login`

To try voting, log in as admin and tap **Start voting**, then log in as a student on another browser or phone.
`npm run db:seed -- --reset` wipes the dev database and reseeds it.

If you already run PostgreSQL (Docker, Postgres.app, a system service), create three databases
(`election_dev`, `election_test`, `election_e2e`) and point the URLs in `.env.local` at them.

---

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Next.js dev server |
| `npm run build` / `npm start` | Production build and server |
| `npm run typecheck` | Generates route types and runs `tsc --noEmit` |
| `npm run lint` | ESLint (zero warnings allowed) |
| `npm test` | Unit tests (Vitest, no database) |
| `npm run test:integration` | Integration tests against `TEST_DATABASE_URL` (applies migrations first) |
| `npm run test:e2e` | Playwright mobile E2E. Builds the app and serves it against `E2E_DATABASE_URL`. |
| `npm run test:all` | Typecheck, lint, unit, integration and E2E |
| `npm run db:local` | Starts a local PostgreSQL (embedded binaries, no Docker) |
| `npm run db:generate` | Generates a new migration from `src/server/db/schema.ts` |
| `npm run db:migrate` | Applies pending migrations (`DATABASE_URL_UNPOOLED` or `DATABASE_URL`). Non-destructive. |
| `npm run db:seed` | Seeds fictional dev data. Refuses in production. Add `-- --reset` to wipe first. |
| `npm run db:reset:test` | Drops and re-migrates the test and E2E databases. Refuses unless the name contains `test`/`e2e`. |
| `npm run admin:create` | Creates an administrator, or with `-- --reset-password` resets one. Creates the election row if missing. |
| `npm run db:cleanup` | After FINALIZED, deletes sessions, recovery tokens and rate-limit counters |

---

## Environment variables

See [.env.example](.env.example).

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection. On Vercel, use Neon's **pooled** connection string (host contains `-pooler`). |
| `DATABASE_URL_UNPOOLED` | no | Direct Neon connection, used by `db:migrate` and `admin:create` when set |
| `APP_ENV` | no | `production` forces production behaviour (blocks seeding). Vercel also sets `VERCEL_ENV`. |
| `APP_URL` | no | Base URL used to build recovery links (defaults to the request origin) |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | no | Non-interactive input for `admin:create` (otherwise it prompts). Never commit these. |
| `REGISTRATION_NUMBER_PATTERN` | no | Regex for the normalized registration number |
| `VOTER_SESSION_HOURS`, `ADMIN_SESSION_HOURS` | no | Session lifetimes (defaults 168 and 12) |
| `RECOVERY_TOKEN_MINUTES` | no | Recovery link lifetime (default 15) |
| `LOGIN_LIMIT_PER_IP`, `SIGNUP_LIMIT_PER_IP` | no | Per-IP limits (defaults 200 per 15 min and 150 per hour) |
| `ALLOW_INSECURE_COOKIES` | no | `true` allows non-Secure cookies for a production build on `http://localhost` (E2E only). **Ignored on Vercel.** |
| `TEST_DATABASE_URL`, `E2E_DATABASE_URL` | tests | Disposable databases. Names must contain `test` or `e2e`. |

No session secret is needed: sessions are random tokens looked up in the database, not signed cookies.

---

## Testing

| Suite | Count | Where |
|---|---|---|
| Unit | 64 tests | `tests/unit`: validation and normalization, election rules and state machine, selection rules, tallying and turnout, CSV (including formula injection), Argon2id, tokens, session expiry, cookie flags, CSRF origin check |
| Integration (real PostgreSQL) | 88 tests | `tests/integration`: all 34 required scenarios, plus raw-SQL checks of every database guard and HTTP-level authorization for every admin endpoint |
| E2E (Playwright) | 10 tests × 3 phone profiles | `tests/e2e`: student journey, admin journey, password recovery, password change, the full 37-step lifecycle, and layout and touch-target checks |

**Mobile E2E coverage.** Every spec runs on:

- `narrow-320`: Chromium, 320×640, touch, mobile
- `android-pixel-7`: Pixel 7 profile (Chromium)
- `iphone-14`: iPhone 14 profile (WebKit)

All interactions use `tap()`. Every major page is checked for horizontal overflow and for touch targets of at least 44×44 px.

The integration and E2E suites verify **database state** (participation, ballots, choices, tallies), not just HTTP status codes.

---

## Deploying to Vercel + Neon

Nothing below has been done for you: each step needs your accounts. There is no deployed URL yet.

1. **Create a GitHub repository** (private is fine) and push this code:
   ```bash
   git add -A && git commit -m "College election app"
   git remote add origin https://github.com/<you>/<repo>.git
   git push -u origin main
   ```
   CI (`.github/workflows/ci.yml`) runs typecheck, lint, unit, integration, build and mobile E2E against a PostgreSQL service container.
2. **Create a Neon project** at neon.tech. Pick a region close to your Vercel region. Copy both connection strings: **pooled** (`…-pooler…`) and **direct**.
3. **Create a Vercel project:** "Add New → Project", import the repository. The framework preset (Next.js) and default build settings are correct.
   (Alternatively, add Neon from the Vercel Marketplace, which creates the project and env vars for you.)
4. **Set environment variables** in Vercel → Settings → Environment Variables (Production):
   - `DATABASE_URL` = Neon **pooled** connection string
   - `APP_ENV` = `production`
   - optional: `APP_URL` = `https://<your-domain>`, `REGISTRATION_NUMBER_PATTERN`
5. **Run migrations** from your machine against the **direct** connection string. The build never migrates.
   ```bash
   DATABASE_URL_UNPOOLED="postgres://…direct…" npm run db:migrate
   ```
6. **Create the first administrator** (and the election row):
   ```bash
   DATABASE_URL_UNPOOLED="postgres://…direct…" npm run admin:create -- --username <name> --election-name "Student Council Election 2026"
   ```
   You will be prompted for a password of at least 12 characters. Do **not** run `db:seed` in production.
7. **Deploy:** push to `main`, or click "Deploy" in Vercel.
8. **Smoke test on a phone** before telling students:
   - Admin: log in at `/admin/login`, set M and add candidates (or import the CSV).
   - Signup: register a test student account, check the waiting screen, refresh, log out and log in again.
   - Activation: start voting on a **throwaway rehearsal** first (see the warning below). The student should see the ballot after a refresh.
   - Ballot: vote, check the confirmation, then confirm a second attempt is refused.
   - Results: the admin overview shows turnout 1 and the totals. Export the CSVs.
   > ⚠ Voting cannot be reopened and votes cannot be deleted through the app. Rehearse on a **separate Neon branch or database**
   > (for example a Vercel Preview deployment with its own `DATABASE_URL`), not on the real election database.
9. **Backups:** see below.

---

## Real election data

- **Candidates:** add them at **Admin → Candidates**, or import a CSV ([template](public/templates/candidates-template.csv)):
  `name,description` with a header row. Every row is validated (required name, at most 100 characters, no duplicates)
  before anything is saved. Tick "Replace all existing candidates" to remove the sample list in one step.
- **Students** register themselves. There is no student list to import.
- No code changes are needed for real data.

---

## Exports, backups, retention and teardown

- **Exports** (admin overview, CSV, UTF-8, safe against spreadsheet formula injection):
  - `results.csv`: totals per candidate, sorted by votes, plus turnout and a consistency check
  - `participation.csv`: name, registration number, eligible, voted (no choices)
  - `audit.csv`: administrative actions
- **Backups:** Neon keeps point-in-time history (restore window depends on your plan). Before and after voting, also take a
  logical backup: `pg_dump "<direct connection string>" > election-backup.sql`, and download all three CSVs.
- **Retention:** once results are announced and any challenge period has passed:
  1. Finalize the election and download the exports.
  2. Run `npm run db:cleanup` to delete sessions, recovery tokens and rate-limit counters.
  3. For full teardown, delete the Neon project, which removes all names, registration numbers and password hashes,
     then remove the Vercel project. Keep the exported results according to your institution's policy.

---

## Security notes

- **CSRF:** every mutation is a JSON `POST`, `PATCH` or `DELETE`, so an HTML form cannot forge one. The `Origin` header must match the host, and cookies are SameSite.
- **XSS:** React escapes all output, and no user content is rendered as HTML. A CSP, `X-Frame-Options: DENY`, `nosniff`,
  `Referrer-Policy: no-referrer` and HSTS are set in `next.config.ts`.
- **SQL injection:** every query is parameterized through Drizzle's query builder or `sql` template. The only `sql.raw`
  is the test/seed `TRUNCATE`, built from a constant table list.
- **Authorization:** every admin route calls `requireAdmin`. A student cookie is never accepted as an admin session, or the reverse
  (tested for every admin endpoint).
- **Secrets:** nothing secret is exposed to the browser (there are no `NEXT_PUBLIC_*` variables). Password hashes are never returned by any endpoint.
- **Admin provisioning:** CLI only. There are no default production credentials.

---

## Known limitations

- Registration does not prove ownership of a registration number (see above).
- Ballot secrecy is application-level only. Live totals and direct database access allow inference (see [Ballot confidentiality](#ballot-confidentiality)).
- Per-IP limits are deliberately generous because a campus network shares IP addresses. Per-account limits are strict.
- `CSP` allows `'unsafe-inline'` scripts, which Next.js needs without nonces. This is acceptable because no user HTML is rendered.
- Only one election per deployment (by design).
- The E2E suite emulates phones in Chromium and WebKit. Real devices have not been tested by this project: try it on a few phones before election day.
- The GitHub Actions workflow is written but has not been run, because no repository exists yet. Locally, all suites pass on Windows with PostgreSQL 17.
