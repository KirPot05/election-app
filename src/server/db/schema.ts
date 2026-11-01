/**
 * Database schema (PostgreSQL via Drizzle ORM).
 *
 * Confidentiality design:
 *  - `voters` + `voter_participation` record WHO voted.
 *  - `ballots` + `ballot_choices` record WHAT was chosen.
 *  - There is no foreign key, shared id, timestamp or sequence linking the two
 *    groups. Ballot ids are random UUIDs and ballots carry no timestamps.
 *
 * Additional integrity rules that Drizzle cannot express (state-transition
 * guards, append-only ballots, ballot size limits, single-election row) live
 * in the hand-written migration `drizzle/0001_integrity_triggers.sql`.
 */
import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const electionStatus = pgEnum("election_status", [
  "DRAFT",
  "OPEN",
  "CLOSED",
  "FINALIZED",
]);

export const resultsVisibility = pgEnum("results_visibility", [
  "LIVE",
  "AFTER_CLOSE",
]);

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const elections = pgTable(
  "elections",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    maxSelections: integer("max_selections").notNull(),
    status: electionStatus("status").notNull().default("DRAFT"),
    resultsVisibility: resultsVisibility("results_visibility")
      .notNull()
      .default("LIVE"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    openedAt: ts("opened_at"),
    closedAt: ts("closed_at"),
    finalizedAt: ts("finalized_at"),
  },
  (t) => [
    check("elections_max_selections_positive", sql`${t.maxSelections} >= 1`),
    check(
      "elections_name_length",
      sql`char_length(${t.name}) BETWEEN 1 AND 120`,
    ),
    // Exactly one election per deployment.
    uniqueIndex("elections_singleton").on(sql`(true)`),
  ],
);

export const candidates = pgTable(
  "candidates",
  {
    id: serial("id").primaryKey(),
    electionId: integer("election_id")
      .notNull()
      .references(() => elections.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    displayOrder: integer("display_order").notNull().default(0),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    // Candidate identity: names are unique within an election (case-insensitive).
    uniqueIndex("candidates_election_name_unique").on(
      t.electionId,
      sql`lower(${t.name})`,
    ),
    // Target for the composite FK from ballot_choices.
    unique("candidates_id_election_unique").on(t.id, t.electionId),
    check(
      "candidates_name_length",
      sql`char_length(${t.name}) BETWEEN 1 AND 100`,
    ),
    check(
      "candidates_description_length",
      sql`char_length(${t.description}) <= 300`,
    ),
  ],
);

export const voters = pgTable(
  "voters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fullName: text("full_name").notNull(),
    /** As typed by the student (trimmed), for display. */
    registrationNumber: text("registration_number").notNull(),
    /** Canonical form used for login and uniqueness. */
    registrationNumberNormalized: text("registration_number_normalized")
      .notNull()
      .unique("voters_registration_number_unique"),
    passwordHash: text("password_hash").notNull(),
    eligible: boolean("eligible").notNull().default(true),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check(
      "voters_full_name_length",
      sql`char_length(${t.fullName}) BETWEEN 1 AND 100`,
    ),
    check(
      "voters_registration_number_length",
      sql`char_length(${t.registrationNumberNormalized}) BETWEEN 1 AND 40`,
    ),
  ],
);

export const adminUsers = pgTable("admin_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  username: text("username").notNull().unique("admin_users_username_unique"),
  passwordHash: text("password_hash").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const sessions = pgTable(
  "sessions",
  {
    /** SHA-256 of the session token; the raw token only exists in the cookie. */
    id: text("id").primaryKey(),
    voterId: uuid("voter_id").references(() => voters.id, {
      onDelete: "cascade",
    }),
    adminId: uuid("admin_id").references(() => adminUsers.id, {
      onDelete: "cascade",
    }),
    createdAt: ts("created_at").notNull().defaultNow(),
    expiresAt: ts("expires_at").notNull(),
  },
  (t) => [
    check(
      "sessions_exactly_one_subject",
      sql`(${t.voterId} IS NULL) <> (${t.adminId} IS NULL)`,
    ),
    index("sessions_voter_idx").on(t.voterId),
    index("sessions_admin_idx").on(t.adminId),
  ],
);

/**
 * Who has voted. The primary key makes a second participation row for the
 * same voter impossible, independent of any application-level locking.
 * Intentionally has no timestamp column.
 */
export const voterParticipation = pgTable(
  "voter_participation",
  {
    electionId: integer("election_id")
      .notNull()
      .references(() => elections.id, { onDelete: "restrict" }),
    voterId: uuid("voter_id")
      .notNull()
      .references(() => voters.id, { onDelete: "restrict" }),
    /** Client-generated idempotency key of the accepted submission. */
    submissionKey: uuid("submission_key").notNull(),
  },
  (t) => [primaryKey({ columns: [t.electionId, t.voterId] })],
);

/** Anonymous ballots. No voter reference, no timestamp, random id. */
export const ballots = pgTable(
  "ballots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    electionId: integer("election_id")
      .notNull()
      .references(() => elections.id, { onDelete: "restrict" }),
  },
  (t) => [unique("ballots_id_election_unique").on(t.id, t.electionId)],
);

export const ballotChoices = pgTable(
  "ballot_choices",
  {
    ballotId: uuid("ballot_id").notNull(),
    electionId: integer("election_id").notNull(),
    candidateId: integer("candidate_id").notNull(),
  },
  (t) => [
    // A candidate can appear at most once per ballot.
    primaryKey({ columns: [t.ballotId, t.candidateId] }),
    // Choice and ballot must belong to the same election ...
    foreignKey({
      name: "ballot_choices_ballot_fk",
      columns: [t.ballotId, t.electionId],
      foreignColumns: [ballots.id, ballots.electionId],
    }).onDelete("restrict"),
    // ... and so must the chosen candidate.
    foreignKey({
      name: "ballot_choices_candidate_fk",
      columns: [t.candidateId, t.electionId],
      foreignColumns: [candidates.id, candidates.electionId],
    }).onDelete("restrict"),
    index("ballot_choices_candidate_idx").on(t.candidateId),
  ],
);

export const recoveryTokens = pgTable(
  "recovery_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    voterId: uuid("voter_id")
      .notNull()
      .references(() => voters.id, { onDelete: "cascade" }),
    /** SHA-256 of the token. The raw token is shown to the admin once. */
    tokenHash: text("token_hash")
      .notNull()
      .unique("recovery_tokens_hash_unique"),
    createdByAdminId: uuid("created_by_admin_id").references(
      () => adminUsers.id,
      { onDelete: "set null" },
    ),
    createdAt: ts("created_at").notNull().defaultNow(),
    expiresAt: ts("expires_at").notNull(),
    usedAt: ts("used_at"),
    revokedAt: ts("revoked_at"),
  },
  (t) => [index("recovery_tokens_voter_idx").on(t.voterId)],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    occurredAt: ts("occurred_at").notNull().defaultNow(),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id"),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    details: jsonb("details").$type<Record<string, unknown>>(),
  },
  (t) => [index("audit_events_occurred_idx").on(t.occurredAt)],
);

/** Fixed-window counters for brute-force protection (keys are hashed). */
export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: ts("window_start").notNull(),
  count: integer("count").notNull(),
});

export type Election = typeof elections.$inferSelect;
export type Candidate = typeof candidates.$inferSelect;
export type Voter = typeof voters.$inferSelect;
export type ElectionStatus = (typeof electionStatus.enumValues)[number];
export type ResultsVisibility = (typeof resultsVisibility.enumValues)[number];
