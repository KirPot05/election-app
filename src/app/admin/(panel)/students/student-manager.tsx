"use client";

import { useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Alert, Button, Card } from "@/components/ui";
import { api } from "@/lib/client-api";

type Student = {
  id: string;
  fullName: string;
  registrationNumber: string;
  eligible: boolean;
  hasVoted: boolean;
  registeredAt: string;
};

type Filter = "all" | "voted" | "not_voted" | "ineligible";

type Recovery = { recoveryUrl: string; token: string; expiresAt: string; student: { fullName: string; registrationNumber: string } };

const FILTERS: [Filter, string][] = [
  ["all", "All"],
  ["voted", "Voted"],
  ["not_voted", "Not voted"],
  ["ineligible", "Ineligible"],
];

export function StudentManager({ initial, eligibilityEditable }: { initial: Student[]; eligibilityEditable: boolean }) {
  const [students, setStudents] = useState(initial);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetTarget, setResetTarget] = useState<Student | null>(null);
  const [eligibilityTarget, setEligibilityTarget] = useState<Student | null>(null);
  const [busy, setBusy] = useState(false);
  const [recovery, setRecovery] = useState<Recovery | null>(null);
  const [copied, setCopied] = useState(false);
  const first = useRef(true);

  async function load(query = q, f = filter) {
    setLoading(true);
    const params = new URLSearchParams({ q: query, filter: f });
    const res = await api<{ students: Student[] }>(`/api/admin/students?${params}`);
    setLoading(false);
    if (res.ok) {
      setStudents(res.data.students);
      setError(null);
    } else {
      setError(res.error.message);
    }
  }

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => void load(q, filter), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, filter]);

  async function issueRecovery() {
    if (!resetTarget) return;
    setBusy(true);
    const res = await api<Recovery>(`/api/admin/students/${resetTarget.id}/recovery`, { body: { confirm: true } });
    setBusy(false);
    setResetTarget(null);
    if (res.ok) {
      setCopied(false);
      setRecovery(res.data);
    } else {
      setError(res.error.message);
    }
  }

  async function toggleEligibility() {
    if (!eligibilityTarget) return;
    setBusy(true);
    const res = await api(`/api/admin/students/${eligibilityTarget.id}/eligibility`, {
      body: { eligible: !eligibilityTarget.eligible },
    });
    setBusy(false);
    setEligibilityTarget(null);
    if (!res.ok) setError(res.error.message);
    await load();
  }

  const counts = {
    total: students.length,
    voted: students.filter((s) => s.hasVoted).length,
  };

  return (
    <div className="flex flex-col gap-4">
      {recovery && (
        <Card className="border-amber-300 bg-amber-50" data-testid="recovery-result">
          <h2 className="text-lg font-bold">Recovery link for {recovery.student.fullName}</h2>
          <p className="mt-1 text-sm text-slate-700">
            {recovery.student.registrationNumber} · single use · expires at{" "}
            {new Date(recovery.expiresAt).toLocaleTimeString()}
          </p>
          <p className="mt-3 rounded-lg border border-amber-300 bg-white p-3 font-mono text-sm break-all" data-testid="recovery-url">
            {recovery.recoveryUrl}
          </p>
          <Alert tone="warning" className="mt-3">
            This link is shown <strong>only once</strong>. Give it to the student privately (in person or by direct message) after
            verifying their identity. The student&apos;s existing sessions have been signed out.
          </Alert>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Button
              variant="secondary"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(recovery.recoveryUrl);
                  setCopied(true);
                } catch {
                  setCopied(false);
                }
              }}
            >
              {copied ? "Copied" : "Copy link"}
            </Button>
            <Button onClick={() => setRecovery(null)}>Done</Button>
          </div>
        </Card>
      )}

      <Card>
        <label htmlFor="student-search" className="text-sm font-semibold">
          Search by name or registration number
        </label>
        <input
          id="student-search"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="e.g. Asha or 21CS001"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
          className="mt-1.5 min-h-12 w-full rounded-xl border border-slate-300 px-4 text-base"
        />
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label="Filter">
          {FILTERS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              aria-pressed={filter === value}
              className={`min-h-11 rounded-lg border px-3 text-sm font-semibold ${
                filter === value ? "border-indigo-700 bg-indigo-700 text-white" : "border-slate-300 bg-white text-slate-800"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </Card>

      {error && <Alert tone="error">{error}</Alert>}

      <p className="text-sm text-slate-600" aria-live="polite" data-testid="student-count">
        {loading ? "Loading…" : `${counts.total} shown · ${counts.voted} voted`}
      </p>

      <ul className="flex flex-col gap-3" data-testid="student-list">
        {students.map((s) => (
          <li key={s.id} data-testid="student-row" data-registration={s.registrationNumber}>
            <Card className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold">{s.fullName}</p>
                  <p className="font-mono text-sm text-slate-600">{s.registrationNumber}</p>
                </div>
                <div className="flex flex-wrap gap-1">
                  {s.hasVoted ? (
                    <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-900" data-testid="voted-badge">
                      Voted
                    </span>
                  ) : (
                    <span className="rounded-full bg-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-800">Not voted</span>
                  )}
                  {!s.eligible && (
                    <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-900">Ineligible</span>
                  )}
                </div>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Button variant="secondary" className="min-h-11 py-2 text-sm" onClick={() => setResetTarget(s)}>
                  Reset password
                </Button>
                {eligibilityEditable && (
                  <Button variant="ghost" className="min-h-11 py-2 text-sm" onClick={() => setEligibilityTarget(s)}>
                    {s.eligible ? "Revoke eligibility" : "Restore eligibility"}
                  </Button>
                )}
              </div>
            </Card>
          </li>
        ))}
      </ul>
      {students.length === 0 && !loading && <p className="text-center text-slate-600">No students match.</p>}

      <ConfirmDialog
        open={!!resetTarget}
        title="Reset this student's password?"
        confirmLabel="Create recovery link"
        loading={busy}
        onCancel={() => setResetTarget(null)}
        onConfirm={issueRecovery}
      >
        <p>
          <strong>{resetTarget?.fullName}</strong> ({resetTarget?.registrationNumber})
        </p>
        <ul className="mt-2 list-disc pl-5 text-sm">
          <li>Verify the student&apos;s identity (e.g. college ID) before continuing.</li>
          <li>The student is signed out on all devices.</li>
          <li>A single-use link valid for 15 minutes is created. Any earlier link stops working.</li>
          <li>Voting status and ballots are not affected.</li>
        </ul>
      </ConfirmDialog>

      <ConfirmDialog
        open={!!eligibilityTarget}
        title={eligibilityTarget?.eligible ? "Revoke eligibility?" : "Restore eligibility?"}
        confirmLabel={eligibilityTarget?.eligible ? "Revoke" : "Restore"}
        confirmVariant={eligibilityTarget?.eligible ? "danger" : "primary"}
        loading={busy}
        onCancel={() => setEligibilityTarget(null)}
        onConfirm={toggleEligibility}
      >
        <p>
          {eligibilityTarget?.eligible
            ? `${eligibilityTarget?.fullName} will not be able to vote. Use this only for accounts that should not take part (e.g. duplicates or non-students).`
            : `${eligibilityTarget?.fullName} will be able to vote when voting opens.`}
        </p>
      </ConfirmDialog>
    </div>
  );
}
