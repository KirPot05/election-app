import type { Metadata } from "next";
import { Card, PageTitle } from "@/components/ui";
import { getDb } from "@/server/db";
import { listAuditEvents } from "@/server/services/audit";

export const metadata: Metadata = { title: "Audit log" };

export default async function AuditPage() {
  const events = await listAuditEvents(getDb(), 200);
  return (
    <>
      <PageTitle sub="Administrative actions (latest 200). Votes are not logged.">Audit log</PageTitle>
      <a
        href="/api/admin/export/audit.csv"
        download
        className="mb-4 inline-flex min-h-11 items-center font-semibold text-indigo-700 underline"
      >
        Download full audit log (CSV)
      </a>
      <Card className="p-0">
        <ol className="divide-y divide-slate-200">
          {events.map((e) => (
            <li key={e.id} className="px-4 py-3">
              <p className="font-mono text-sm font-semibold">{e.action}</p>
              <p className="text-xs text-slate-600">
                {e.occurredAt.toISOString().replace("T", " ").slice(0, 19)} UTC · {e.actorType}
                {e.targetType ? ` · ${e.targetType} ${e.targetId ?? ""}` : ""}
              </p>
              {e.details && <p className="mt-1 text-xs break-all text-slate-700">{JSON.stringify(e.details)}</p>}
            </li>
          ))}
          {events.length === 0 && <li className="px-4 py-3 text-slate-600">No events yet.</li>}
        </ol>
      </Card>
    </>
  );
}
