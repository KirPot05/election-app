import { desc } from "drizzle-orm";
import type { DbOrTx } from "@/server/db";
import { auditEvents } from "@/server/db/schema";

/**
 * Administrative audit trail. Never record ballot contents, passwords,
 * tokens, or anything that links a voter to a ballot. Ballot casting itself
 * is deliberately not audited (participation is already recorded, and a
 * timestamped event per vote would aid timing correlation).
 */
export type AuditAction =
  | "admin.login"
  | "admin.logout"
  | "election.created"
  | "election.configured"
  | "election.opened"
  | "election.closed"
  | "election.finalized"
  | "candidate.created"
  | "candidate.updated"
  | "candidate.deleted"
  | "candidate.imported"
  | "voter.eligibility_changed"
  | "voter.password_changed"
  | "recovery.issued"
  | "recovery.completed";

export async function recordAudit(
  db: DbOrTx,
  event: {
    actorType: "admin" | "voter" | "system";
    actorId?: string | null;
    action: AuditAction;
    targetType?: string;
    targetId?: string | number;
    details?: Record<string, unknown>;
  },
): Promise<void> {
  await db.insert(auditEvents).values({
    actorType: event.actorType,
    actorId: event.actorId ?? null,
    action: event.action,
    targetType: event.targetType ?? null,
    targetId: event.targetId === undefined ? null : String(event.targetId),
    details: event.details ?? null,
  });
}

export async function listAuditEvents(db: DbOrTx, limit = 500) {
  return db.select().from(auditEvents).orderBy(desc(auditEvents.id)).limit(limit);
}
