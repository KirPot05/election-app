import type { Metadata } from "next";
import { PageTitle } from "@/components/ui";
import { getDb } from "@/server/db";
import { candidateCount, getElection } from "@/server/services/election";
import { ElectionForm } from "./election-form";

export const metadata: Metadata = { title: "Election settings" };

export default async function ElectionSettingsPage() {
  const db = getDb();
  const election = await getElection(db);
  const k = election ? await candidateCount(db, election.id) : 0;
  return (
    <>
      <PageTitle sub="Name, maximum selections per student and results visibility.">Election settings</PageTitle>
      <ElectionForm
        election={
          election
            ? {
                name: election.name,
                maxSelections: election.maxSelections,
                resultsVisibility: election.resultsVisibility,
                status: election.status,
              }
            : null
        }
        candidateCount={k}
      />
    </>
  );
}
