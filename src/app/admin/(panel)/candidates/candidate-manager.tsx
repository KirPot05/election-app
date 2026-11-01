"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Alert, Button, Card, Field } from "@/components/ui";
import { api } from "@/lib/client-api";

type Candidate = { id: number; name: string; description: string };

export function CandidateManager({ initial, editable }: { initial: Candidate[]; editable: boolean }) {
  const router = useRouter();
  const [candidates, setCandidates] = useState(initial);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<Candidate | null>(null);
  const [busy, setBusy] = useState(false);

  async function reload() {
    const res = await api<{ candidates: Candidate[] }>("/api/admin/candidates");
    if (res.ok) setCandidates(res.data.candidates);
    router.refresh();
  }

  function report(res: Awaited<ReturnType<typeof api>>, success: string) {
    setMessage(res.ok ? { tone: "success", text: success } : { tone: "error", text: res.error.message });
    return res.ok;
  }

  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const form = e.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    const res = await api("/api/admin/candidates", {
      body: { name: String(data.get("newName") ?? ""), description: String(data.get("newDescription") ?? "") },
    });
    setBusy(false);
    if (report(res, "Candidate added.")) {
      form.reset();
      await reload();
    }
  }

  async function save(id: number, e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setBusy(true);
    const res = await api(`/api/admin/candidates/${id}`, {
      method: "PATCH",
      body: { name: String(data.get("editName") ?? ""), description: String(data.get("editDescription") ?? "") },
    });
    setBusy(false);
    if (report(res, "Candidate updated.")) {
      setEditing(null);
      await reload();
    }
  }

  async function remove() {
    if (!deleting) return;
    setBusy(true);
    const res = await api(`/api/admin/candidates/${deleting.id}`, { method: "DELETE", body: {} });
    setBusy(false);
    setDeleting(null);
    if (report(res, "Candidate deleted.")) await reload();
  }

  async function importCsv(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const form = e.currentTarget;
    const file = (form.elements.namedItem("csvFile") as HTMLInputElement).files?.[0];
    const replace = (form.elements.namedItem("replace") as HTMLInputElement).checked;
    if (!file) {
      setMessage({ tone: "error", text: "Choose a CSV file first." });
      return;
    }
    if (file.size > 200_000) {
      setMessage({ tone: "error", text: "The file is too large (max 200 KB)." });
      return;
    }
    setBusy(true);
    const csv = await file.text();
    const res = await api<{ imported: number }>("/api/admin/candidates/import", { body: { csv, replace } });
    setBusy(false);
    if (report(res, res.ok ? `Imported ${res.data.imported} candidate(s).` : "")) {
      form.reset();
      await reload();
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {!editable && (
        <Alert tone="warning" title="Locked">
          Candidates can only be changed before voting starts.
        </Alert>
      )}
      {message && (
        <Alert tone={message.tone}>
          <span className="whitespace-pre-line">{message.text}</span>
        </Alert>
      )}

      {editable && (
        <Card>
          <h2 className="text-lg font-bold">Add a candidate</h2>
          <form onSubmit={add} noValidate className="mt-3 flex flex-col gap-3">
            <Field id="newName" label="Name" required maxLength={100} autoComplete="off" />
            <Field id="newDescription" label="Description (optional)" maxLength={300} autoComplete="off" hint="e.g. department and year" />
            <Button type="submit" loading={busy} className="w-full">
              Add candidate
            </Button>
          </form>
        </Card>
      )}

      <Card>
        <h2 className="text-lg font-bold">Candidates ({candidates.length})</h2>
        {candidates.length === 0 ? (
          <p className="mt-2 text-slate-600">No candidates yet.</p>
        ) : (
          <ol className="mt-3 flex flex-col divide-y divide-slate-200" data-testid="candidate-list">
            {candidates.map((c, i) => (
              <li key={c.id} className="py-3" data-testid="candidate-row">
                {editing === c.id ? (
                  <form onSubmit={(e) => save(c.id, e)} noValidate className="flex flex-col gap-3">
                    <Field id="editName" label="Name" defaultValue={c.name} maxLength={100} required />
                    <Field id="editDescription" label="Description" defaultValue={c.description} maxLength={300} />
                    <div className="grid grid-cols-2 gap-3">
                      <Button variant="secondary" onClick={() => setEditing(null)}>
                        Cancel
                      </Button>
                      <Button type="submit" loading={busy}>
                        Save
                      </Button>
                    </div>
                  </form>
                ) : (
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold">
                        <span className="mr-2 text-slate-500 tabular-nums">{i + 1}.</span>
                        {c.name}
                      </p>
                      {c.description && <p className="text-sm text-slate-600">{c.description}</p>}
                    </div>
                    {editable && (
                      <div className="flex shrink-0 gap-1">
                        <Button variant="ghost" className="min-h-11 px-3 py-2 text-sm" onClick={() => setEditing(c.id)} aria-label={`Edit ${c.name}`}>
                          Edit
                        </Button>
                        <Button variant="ghost" className="min-h-11 px-3 py-2 text-sm text-red-700" onClick={() => setDeleting(c)} aria-label={`Delete ${c.name}`}>
                          Delete
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
      </Card>

      {editable && (
        <Card>
          <h2 className="text-lg font-bold">Import from CSV</h2>
          <p className="mt-1 text-sm text-slate-600">
            Columns: <code>name</code> (required) and <code>description</code> (optional), with a header row. Every row is
            checked before anything is saved.{" "}
            <a href="/templates/candidates-template.csv" download className="font-semibold text-indigo-700 underline">
              Download template
            </a>
          </p>
          <form onSubmit={importCsv} className="mt-3 flex flex-col gap-3">
            <input
              type="file"
              name="csvFile"
              accept=".csv,text/csv"
              aria-label="Candidate CSV file"
              className="block w-full text-sm file:mr-3 file:min-h-11 file:rounded-lg file:border-0 file:bg-slate-200 file:px-4 file:font-semibold"
            />
            <label className="flex min-h-11 items-center gap-3 text-sm">
              <input type="checkbox" name="replace" className="size-5 accent-indigo-700" />
              Replace all existing candidates
            </label>
            <Button type="submit" variant="secondary" loading={busy} className="w-full">
              Import candidates
            </Button>
          </form>
        </Card>
      )}

      <ConfirmDialog
        open={!!deleting}
        title="Delete candidate?"
        confirmLabel="Delete"
        confirmVariant="danger"
        loading={busy}
        onCancel={() => setDeleting(null)}
        onConfirm={remove}
      >
        <p>
          Remove <strong>{deleting?.name}</strong> from the ballot?
        </p>
      </ConfirmDialog>
    </div>
  );
}
