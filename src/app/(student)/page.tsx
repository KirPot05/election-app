import Link from "next/link";
import { redirect } from "next/navigation";
import { ButtonLink, Card, StatusBadge } from "@/components/ui";
import { getCurrentVoter } from "@/server/auth/current";
import { getDb } from "@/server/db";
import { getElection } from "@/server/services/election";

export default async function Home() {
  if (await getCurrentVoter()) redirect("/dashboard");
  const election = await getElection(getDb());
  const registrationOpen = election?.status === "DRAFT";

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <p className="text-sm font-semibold uppercase tracking-wide text-indigo-700">Student voting</p>
        <h1 className="mt-1 text-2xl font-bold">{election?.name ?? "College Election"}</h1>
        {election && (
          <div className="mt-3">
            <StatusBadge status={election.status} />
          </div>
        )}
        <p className="mt-4 text-base text-slate-700">
          {registrationOpen
            ? "Register with your full name and college registration number, then vote from this phone when voting opens."
            : "Log in with your registration number and password to see the election status."}
        </p>
        <div className="mt-5 flex flex-col gap-3">
          {registrationOpen && <ButtonLink href="/signup">Register to vote</ButtonLink>}
          <ButtonLink href="/login" variant={registrationOpen ? "secondary" : "primary"}>
            Log in
          </ButtonLink>
        </div>
      </Card>
      <p className="text-center text-sm text-slate-600">
        Forgot your password? Ask the election administrator for a reset link.
      </p>
      <p className="text-center">
        <Link href="/admin/login" className="inline-flex min-h-11 items-center text-sm text-slate-500 underline">
          Administrator login
        </Link>
      </p>
    </div>
  );
}
