"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { Alert, Button, Card } from "@/components/ui";
import { api } from "@/lib/client-api";

type Candidate = { id: number; name: string; description: string };

/** RFC 4122 v4 UUID; crypto.randomUUID is unavailable on plain-HTTP origins. */
function uuid(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

type Phase =
  | { kind: "select" }
  | { kind: "review" }
  | { kind: "submitting" }
  | { kind: "checking" }
  | { kind: "not-recorded"; message: string }
  | { kind: "unknown" }
  | { kind: "closed"; message: string };

/**
 * Ballot flow: select (1..M) -> review -> confirm -> server.
 *
 * Duplicate protection on the client (the server is authoritative):
 *  - an in-flight ref ignores repeated taps;
 *  - one submission key (UUID) per reviewed selection, reused on retry, so a
 *    retried request after a dropped connection is idempotent on the server.
 * If the connection drops, we never ask the student to "vote again"; we ask
 * the server whether a ballot was recorded and show the confirmed outcome.
 */
export function Ballot({ candidates, maxSelections }: { candidates: Candidate[]; maxSelections: number }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [phase, setPhase] = useState<Phase>({ kind: "select" });
  const [limitNotice, setLimitNotice] = useState(false);
  const inFlight = useRef(false);
  const submissionKey = useRef<string | null>(null);

  const atMax = selected.size >= maxSelections;
  const chosen = useMemo(() => candidates.filter((c) => selected.has(c.id)), [candidates, selected]);

  function toggle(id: number) {
    if (phase.kind !== "select") return;
    const next = new Set(selected);
    if (next.has(id)) {
      next.delete(id);
      setLimitNotice(false);
    } else if (next.size >= maxSelections) {
      setLimitNotice(true); // over-selection is prevented, and explained
      return;
    } else {
      next.add(id);
    }
    setSelected(next);
  }

  function review() {
    if (selected.size === 0 || selected.size > maxSelections) return;
    submissionKey.current = uuid();
    setPhase({ kind: "review" });
    window.scrollTo({ top: 0 });
  }

  async function checkStatus() {
    setPhase({ kind: "checking" });
    const res = await api<{ hasVoted: boolean; screen: string }>("/api/student/status", { timeoutMs: 10_000 });
    if (res.ok && res.data.hasVoted) return finish();
    if (res.ok && res.data.screen !== "BALLOT") {
      setPhase({ kind: "closed", message: "Voting is no longer open. Your ballot was not recorded." });
      return;
    }
    if (res.ok) {
      setPhase({ kind: "not-recorded", message: "Your vote was not recorded. You can safely submit it again." });
      return;
    }
    setPhase({ kind: "unknown" });
  }

  function finish() {
    router.replace("/dashboard?voted=1");
    router.refresh();
  }

  async function submit() {
    if (inFlight.current || !submissionKey.current) return;
    inFlight.current = true;
    setPhase({ kind: "submitting" });
    const res = await api<{ status: string }>("/api/student/ballot", {
      body: { candidateIds: [...selected], submissionKey: submissionKey.current },
      timeoutMs: 25_000,
    });
    inFlight.current = false;

    if (res.ok) return finish();
    if (res.kind === "network") return checkStatus();
    switch (res.error.code) {
      case "ALREADY_VOTED":
        return finish();
      case "ELECTION_CLOSED":
      case "ELECTION_NOT_OPEN":
      case "INELIGIBLE":
        setPhase({ kind: "closed", message: res.error.message });
        return;
      case "UNAUTHENTICATED":
        router.replace("/login");
        return;
      default:
        setPhase({ kind: "not-recorded", message: res.error.message });
    }
  }

  if (phase.kind === "closed") {
    return (
      <Card data-testid="ballot-closed">
        <Alert tone="warning">{phase.message}</Alert>
        <Button className="mt-4 w-full" onClick={() => router.refresh()}>
          Refresh status
        </Button>
      </Card>
    );
  }

  if (phase.kind !== "select") {
    const busy = phase.kind === "submitting" || phase.kind === "checking";
    return (
      <Card data-testid="ballot-review" aria-busy={busy}>
        <h2 className="text-xl font-bold">Review your vote</h2>
        <p className="mt-1 text-base text-slate-700">
          You selected {chosen.length} of {maxSelections}:
        </p>
        <ol className="mt-3 flex flex-col gap-2" data-testid="review-list">
          {chosen.map((c) => (
            <li key={c.id} className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 font-semibold text-indigo-950">
              {c.name}
            </li>
          ))}
        </ol>

        {phase.kind === "unknown" && (
          <Alert tone="warning" className="mt-4" title="Connection problem">
            We couldn&apos;t confirm whether your vote was recorded. Don&apos;t worry: it can never be counted twice.
            Tap &ldquo;Check my vote status&rdquo; when your connection is back.
          </Alert>
        )}
        {phase.kind === "not-recorded" && (
          <Alert tone="error" className="mt-4">
            {phase.message}
          </Alert>
        )}
        {phase.kind === "checking" && (
          <Alert className="mt-4">Checking whether your vote was recorded…</Alert>
        )}

        {phase.kind === "unknown" ? (
          <Button className="mt-5 w-full" onClick={checkStatus}>
            Check my vote status
          </Button>
        ) : (
          <>
            <Alert tone="warning" className="mt-4">
              <strong>Your vote is final.</strong> After you confirm, you cannot change your choices or vote again.
            </Alert>
            <div className="mt-5 flex flex-col gap-3">
              <Button onClick={submit} loading={busy} data-testid="confirm-vote">
                {phase.kind === "submitting" ? "Submitting your vote…" : "Confirm and submit vote"}
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  submissionKey.current = null;
                  setPhase({ kind: "select" });
                }}
              >
                Back to edit
              </Button>
            </div>
          </>
        )}
      </Card>
    );
  }

  return (
    <div className="pb-28" data-testid="ballot">
      <Card>
        <h2 className="text-xl font-bold">Choose your candidates</h2>
        <p className="mt-1 text-base text-slate-700">
          Select <strong>up to {maxSelections}</strong> candidate{maxSelections === 1 ? "" : "s"} (at least 1). Each selected
          candidate receives one vote.
        </p>
      </Card>

      <fieldset className="mt-4">
        <legend className="sr-only">Candidates</legend>
        <ul className="flex flex-col gap-3">
          {candidates.map((c) => {
            const checked = selected.has(c.id);
            const blocked = !checked && atMax;
            return (
              <li key={c.id}>
                <label
                  className={`flex min-h-16 cursor-pointer items-center gap-4 rounded-2xl border-2 px-4 py-3 ${
                    checked
                      ? "border-indigo-700 bg-indigo-50"
                      : blocked
                        ? "border-slate-200 bg-white opacity-60"
                        : "border-slate-200 bg-white"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="size-6 shrink-0 accent-indigo-700"
                    checked={checked}
                    aria-disabled={blocked || undefined}
                    onChange={() => toggle(c.id)}
                    data-testid="candidate-option"
                    data-candidate-name={c.name}
                  />
                  <span className="min-w-0">
                    <span className="block text-base font-semibold text-slate-900">{c.name}</span>
                    {c.description && <span className="block text-sm text-slate-600">{c.description}</span>}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>

      <div className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white/95 px-4 pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] shadow-[0_-4px_12px_rgba(0,0,0,0.06)] backdrop-blur">
        <div className="mx-auto flex max-w-xl flex-col gap-2">
          <p className="text-sm" aria-live="polite" data-testid="selection-count">
            <strong>
              {selected.size} of {maxSelections}
            </strong>{" "}
            selected
            {limitNotice && atMax && (
              <span className="ml-1 font-semibold text-amber-800" data-testid="limit-notice">
                · Maximum reached. Deselect one to choose another.
              </span>
            )}
          </p>
          <Button onClick={review} disabled={selected.size === 0} className="w-full" data-testid="review-vote">
            {selected.size === 0 ? "Select at least 1 candidate" : "Review my vote"}
          </Button>
        </div>
      </div>
    </div>
  );
}
