import type { Metadata } from "next";
import { ButtonLink, Card, PageTitle } from "@/components/ui";
import { getDb } from "@/server/db";
import { listCandidates } from "@/server/services/candidates";
import { getElection } from "@/server/services/election";
import { CandidateManager } from "./candidate-manager";

export const metadata: Metadata = { title: "Candidates" };

export default async function CandidatesPage() {
  const db = getDb();
  const election = await getElection(db);
  if (!election) {
    return (
      <Card>
        <PageTitle>Candidates</PageTitle>
        <ButtonLink href="/admin/election" className="w-full">
          Create the election first
        </ButtonLink>
      </Card>
    );
  }
  const candidates = await listCandidates(db, election.id);
  return (
    <>
      <PageTitle sub={`${candidates.length} candidate${candidates.length === 1 ? "" : "s"} · students choose up to ${election.maxSelections}`}>
        Candidates
      </PageTitle>
      <CandidateManager
        initial={candidates.map((c) => ({ id: c.id, name: c.name, description: c.description }))}
        editable={election.status === "DRAFT"}
      />
    </>
  );
}
