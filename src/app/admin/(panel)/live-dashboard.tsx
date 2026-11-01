"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Alert, Button, Card, StatusBadge } from "@/components/ui";
import { api } from "@/lib/client-api";
import { CONFIG_ISSUE_MESSAGES, validateElectionConfig } from "@/lib/election-rules";
import type { AdminDashboard } from "@/server/services/results";

const POLL_MS = 4000;

type Transition = "OPEN" | "CLOSED" | "FINALIZED";

const TRANSITIONS: Record<string, { to: Transition; label: string; title: string; body: string; variant: "primary" | "danger" } | null> = {
  DRAFT: {
    to: "OPEN",
    label: "Start voting",
    title: "Start voting now?",
    body: "Students will be able to vote immediately. New registrations close, and candidates and settings become locked. This cannot be undone.",
    variant: "primary",
  },
  OPEN: {
    to: "CLOSED",
    label: "Stop voting",
    title: "Stop voting now?",
    body: "No further ballots will be accepted. Voting cannot be reopened. Ballots already submitted are kept.",
    variant: "danger",
  },
  CLOSED: {
    to: "FINALIZED",
    label: "Finalize election",
    title: "Finalize the election?",
    body: "This permanently locks the election. Results stay viewable and exportable, but nothing can be changed afterwards.",
    variant: "danger",
  },
  FINALIZED: null,
};

export function LiveDashboard({ initial }: { initial: AdminDashboard }) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [updatedAt, setUpdatedAt] = useState(() => new Date(initial.generatedAt));
  const [stale, setStale] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionDone, setActionDone] = useState<string | null>(null);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    const res = await api<AdminDashboard>("/api/admin/dashboard", { timeoutMs: 8000 });
    inFlight.current = false;
    if (res.ok) {
      setData(res.data);
      setUpdatedAt(new Date(res.data.generatedAt));
      setStale(false);
    } else if (res.kind === "error" && res.status === 401) {
      router.replace("/admin/login");
    } else {
      setStale(true);
    }
  }, [router]);

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const e = data.election!;
  const t = data.turnout;
  const action = TRANSITIONS[e.status];
  const issues = e.status === "DRAFT" ? validateElectionConfig(e.maxSelections, e.candidateCount) : [];
  const maxVotes = Math.max(1, ...(data.totals ?? []).map((c) => c.votes));

  async function runTransition() {
    if (!action) return;
    setTransitioning(true);
    setActionError(null);
    const res = await api<{ status: string }>("/api/admin/election/transition", { body: { to: action.to, confirm: true } });
    setTransitioning(false);
    setDialogOpen(false);
    if (res.ok) {
      setActionDone(`Election status is now ${res.data.status}.`);
      await refresh();
      router.refresh();
    } else {
      setActionError(res.error.message);
      await refresh();
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">{e.name}</h1>
        <StatusBadge status={e.status} />
      </div>

      <p className="text-xs text-slate-500" aria-live="polite" data-testid="last-updated">
        {stale ? "⚠ Connection problem. Showing last known data; retrying… " : "Live · "}
        updated {updatedAt.toLocaleTimeString()}
      </p>

      {!data.consistency.ok && (
        <Alert tone="error" title="Count mismatch detected">
          {data.consistency.problems.join(" ")}
        </Alert>
      )}
      {actionDone && <Alert tone="success">{actionDone}</Alert>}
      {actionError && <Alert tone="error">{actionError}</Alert>}

      <Card>
        <h2 className="text-lg font-bold">Participation</h2>
        <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Registered" value={t.registered} testId="stat-registered" />
          <Stat label="Eligible" value={t.eligible} testId="stat-eligible" />
          <Stat label="Voted" value={t.voted} testId="stat-voted" />
          <Stat label="Not voted" value={t.notVoted} testId="stat-not-voted" />
          <Stat label="Turnout" value={`${t.turnoutPercent}%`} testId="stat-turnout" />
          <Stat label="Ballots" value={data.ballots} testId="stat-ballots" />
        </dl>
        <div className="mt-4 h-3 overflow-hidden rounded-full bg-slate-200" aria-hidden>
          <div className="h-full bg-emerald-600" style={{ width: `${Math.min(100, t.turnoutPercent)}%` }} />
        </div>
      </Card>

      <Card>
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-lg font-bold">Candidate totals</h2>
          <span className="text-sm text-slate-600">
            K = {e.candidateCount}, M = {e.maxSelections}
          </span>
        </div>
        {data.totals ? (
          <ol className="mt-3 flex flex-col gap-3" data-testid="candidate-totals">
            {data.totals.map((c) => (
              <li key={c.candidateId} data-testid="candidate-total" data-name={c.name} data-votes={c.votes}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 font-medium">{c.name}</span>
                  <span className="shrink-0 tabular-nums font-bold">{c.votes}</span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100" aria-hidden>
                  <div className="h-full bg-indigo-600" style={{ width: `${(c.votes / maxVotes) * 100}%` }} />
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <Alert className="mt-3">Results are hidden until voting closes (results visibility setting).</Alert>
        )}
        <p className="mt-3 text-xs text-slate-500">
          Approval counting: each selected candidate receives one vote. Totals only; individual ballots are never shown.
        </p>
      </Card>

      <Card>
        <h2 className="text-lg font-bold">Voting controls</h2>
        {e.status === "DRAFT" && issues.length > 0 && (
          <Alert tone="warning" className="mt-3" title="Voting can't start yet">
            <ul className="list-disc pl-5">
              {issues.map((i) => (
                <li key={i}>{CONFIG_ISSUE_MESSAGES[i]}</li>
              ))}
            </ul>
          </Alert>
        )}
        {action ? (
          <Button
            variant={action.variant}
            className="mt-4 w-full"
            disabled={issues.length > 0}
            onClick={() => {
              setActionDone(null);
              setActionError(null);
              setDialogOpen(true);
            }}
            data-testid="transition-button"
          >
            {action.label}
          </Button>
        ) : (
          <p className="mt-3 text-base text-slate-700">The election is finalized and permanently locked.</p>
        )}
      </Card>

      <Card>
        <h2 className="text-lg font-bold">Export (CSV)</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {data.totals ? (
            <a className="inline-flex min-h-12 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 font-semibold" href="/api/admin/export/results.csv" download data-testid="export-results">
              Results
            </a>
          ) : (
            <span className="inline-flex min-h-12 items-center justify-center rounded-xl border border-slate-200 px-4 text-slate-400">Results (after close)</span>
          )}
          <a className="inline-flex min-h-12 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 font-semibold" href="/api/admin/export/participation.csv" download data-testid="export-participation">
            Participation
          </a>
          <a className="inline-flex min-h-12 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 font-semibold" href="/api/admin/export/audit.csv" download data-testid="export-audit">
            Audit log
          </a>
        </div>
      </Card>

      {action && (
        <ConfirmDialog
          open={dialogOpen}
          title={action.title}
          confirmLabel={action.label}
          confirmVariant={action.variant}
          loading={transitioning}
          onCancel={() => setDialogOpen(false)}
          onConfirm={runTransition}
        >
          <p>{action.body}</p>
          {action.to === "OPEN" && (
            <p className="mt-2 text-sm">
              {e.candidateCount} candidates, up to {e.maxSelections} selection{e.maxSelections === 1 ? "" : "s"} per student.
            </p>
          )}
        </ConfirmDialog>
      )}
    </div>
  );
}

function Stat({ label, value, testId }: { label: string; value: number | string; testId: string }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-600">{label}</dt>
      <dd className="mt-1 text-2xl font-bold tabular-nums" data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}
