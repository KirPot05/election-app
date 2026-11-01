import type { Metadata } from "next";
import Link from "next/link";
import { Alert, Card, StatusBadge } from "@/components/ui";
import { requireVoterPage } from "@/server/auth/current";
import { getDb } from "@/server/db";
import { listCandidates } from "@/server/services/candidates";
import { getElection } from "@/server/services/election";
import { getVoterStatus } from "@/server/services/voters";
import { Ballot } from "./ballot";
import { LogoutButton } from "@/components/logout-button";
import { StatusPoller } from "./status-poller";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const voter = await requireVoterPage();
  const db = getDb();
  const status = await getVoterStatus(db, voter.voterId);
  const sp = await searchParams;
  const welcome = sp.welcome === "1";
  const justVoted = sp.voted === "1";

  let candidates: { id: number; name: string; description: string }[] = [];
  if (status.screen === "BALLOT") {
    const election = await getElection(db);
    candidates = (await listCandidates(db, election!.id)).map((c) => ({ id: c.id, name: c.name, description: c.description }));
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-slate-600">Signed in as</p>
          <p className="font-semibold" data-testid="student-name">
            {voter.fullName}
          </p>
          <p className="text-sm text-slate-600" data-testid="student-registration">
            {voter.registrationNumber}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end">
          <LogoutButton />
          <Link href="/account" className="inline-flex min-h-11 items-center text-sm font-semibold text-indigo-700 underline">
            Change password
          </Link>
        </div>
      </div>

      {status.election && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-bold">{status.election.name}</h1>
          <StatusBadge status={status.election.status} />
        </div>
      )}

      {status.screen === "NOT_CONFIGURED" && (
        <Card>
          <Alert>The election has not been set up yet. Please check back later.</Alert>
        </Card>
      )}

      {status.screen === "WAITING" && (
        <Card data-testid="screen-waiting">
          {welcome ? (
            <Alert tone="success" title="Registration successful!">
              The election has not started yet. Voting will become available when the administrator starts the election.
            </Alert>
          ) : (
            <Alert title="You're registered">
              The election has not started yet. Voting will open here as soon as the administrator starts the election.
            </Alert>
          )}
          <p className="mt-4 text-base text-slate-700">
            You can keep this page open. It checks for updates automatically, or you can refresh at any time. You
            don&apos;t need to log out and back in.
          </p>
          <StatusPoller screen="WAITING" />
        </Card>
      )}

      {status.screen === "BALLOT" && status.election && (
        <Ballot candidates={candidates} maxSelections={status.election.maxSelections} />
      )}

      {status.screen === "VOTED" && (
        <Card data-testid="screen-voted" className="text-center">
          <div aria-hidden className="mx-auto grid size-16 place-items-center rounded-full bg-emerald-100 text-3xl text-emerald-700">
            ✓
          </div>
          <h2 className="mt-4 text-2xl font-bold text-emerald-800">
            {justVoted ? "Vote submitted successfully" : "You have already voted"}
          </h2>
          <p className="mt-2 text-base text-slate-700">
            Your ballot has been recorded. Ballots are final and cannot be changed, and each student can vote only once.
          </p>
          <p className="mt-2 text-sm text-slate-600">Results will be announced by the election administration.</p>
          <StatusPoller screen="VOTED" quiet />
        </Card>
      )}

      {(status.screen === "CLOSED" || status.screen === "FINALIZED") && (
        <Card data-testid={status.screen === "CLOSED" ? "screen-closed" : "screen-finalized"}>
          <h2 className="text-xl font-bold">
            {status.screen === "CLOSED" ? "Voting has closed" : "The election is complete"}
          </h2>
          <p className="mt-2 text-base text-slate-700" data-testid="participation-note">
            {status.hasVoted ? "Your vote was recorded. Thank you for voting." : "You did not vote in this election."}
          </p>
          <p className="mt-2 text-sm text-slate-600">Results will be announced by the election administration.</p>
        </Card>
      )}

      {status.screen === "INELIGIBLE" && (
        <Card data-testid="screen-ineligible">
          <Alert tone="warning" title="Not eligible to vote">
            Your account is not eligible to vote in this election. Please contact the election administrator.
          </Alert>
        </Card>
      )}
    </div>
  );
}
