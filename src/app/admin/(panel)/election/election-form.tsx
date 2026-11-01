"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Alert, Button, Card, Field, StatusBadge } from "@/components/ui";
import { api } from "@/lib/client-api";
import { CONFIG_ISSUE_MESSAGES, validateElectionConfig } from "@/lib/election-rules";

type Props = {
  election: { name: string; maxSelections: number; resultsVisibility: "LIVE" | "AFTER_CLOSE"; status: string } | null;
  candidateCount: number;
};

export function ElectionForm({ election, candidateCount }: Props) {
  const router = useRouter();
  const editable = !election || election.status === "DRAFT";
  const [name, setName] = useState(election?.name ?? "College Election 2026");
  const [max, setMax] = useState(String(election?.maxSelections ?? 1));
  const [visibility, setVisibility] = useState<"LIVE" | "AFTER_CLOSE">(election?.resultsVisibility ?? "LIVE");
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const m = Number(max);
  const issues = validateElectionConfig(Number.isInteger(m) ? m : 0, candidateCount);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!editable || loading) return;
    setLoading(true);
    setMessage(null);
    const res = await api(election ? "/api/admin/election" : "/api/admin/election", {
      method: election ? "PATCH" : "POST",
      body: { name, maxSelections: Number(max), resultsVisibility: visibility },
    });
    setLoading(false);
    if (res.ok) {
      setErrors({});
      setMessage({ tone: "success", text: election ? "Settings saved." : "Election created." });
      router.refresh();
    } else {
      setErrors(res.kind === "error" ? (res.error.fields ?? {}) : {});
      setMessage({ tone: "error", text: res.error.message });
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {election && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-600">Status:</span>
          <StatusBadge status={election.status} />
        </div>
      )}
      {!editable && (
        <Alert tone="warning" title="Locked">
          Settings can only be changed before voting starts.
        </Alert>
      )}
      <Card>
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          {message && <Alert tone={message.tone}>{message.text}</Alert>}
          <Field
            id="electionName"
            label="Election name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!editable}
            maxLength={120}
            error={errors.name}
          />
          <Field
            id="maxSelections"
            label="Maximum selections per student (M)"
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            value={max}
            onChange={(e) => setMax(e.target.value)}
            disabled={!editable}
            error={errors.maxSelections}
            hint={`Students may select between 1 and M candidates. M must be less than the number of candidates (K = ${candidateCount}).`}
          />
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-semibold text-slate-800">Live candidate totals for admins</legend>
            {(
              [
                ["LIVE", "Show live totals during voting", "Totals update every few seconds on the admin overview."],
                ["AFTER_CLOSE", "Hide totals until voting closes", "Reduces the chance of inferring individual choices from changes in totals. Turnout is still live."],
              ] as const
            ).map(([value, label, hint]) => (
              <label key={value} className="flex min-h-12 cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3">
                <input
                  type="radio"
                  name="resultsVisibility"
                  value={value}
                  checked={visibility === value}
                  onChange={() => setVisibility(value)}
                  disabled={!editable}
                  className="mt-1 size-5 accent-indigo-700"
                />
                <span>
                  <span className="block font-medium">{label}</span>
                  <span className="block text-sm text-slate-600">{hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {editable && (
            <Button type="submit" loading={loading} className="w-full">
              {election ? "Save settings" : "Create election"}
            </Button>
          )}
        </form>
      </Card>

      <Card>
        <h2 className="text-lg font-bold">Configuration check</h2>
        <p className="mt-1 text-base text-slate-700">
          {candidateCount} candidate{candidateCount === 1 ? "" : "s"} (K), up to {Number.isInteger(m) ? m : "?"} selection
          {m === 1 ? "" : "s"} (M).
        </p>
        {issues.length === 0 ? (
          <Alert tone="success" className="mt-3">
            Ready: 1 ≤ M &lt; K.
          </Alert>
        ) : (
          <Alert tone="warning" className="mt-3">
            <ul className="list-disc pl-5">
              {issues.map((i) => (
                <li key={i}>{CONFIG_ISSUE_MESSAGES[i]}</li>
              ))}
            </ul>
          </Alert>
        )}
        <Link href="/admin/candidates" className="mt-3 inline-flex min-h-11 items-center font-semibold text-indigo-700 underline">
          Manage candidates →
        </Link>
      </Card>
    </div>
  );
}
