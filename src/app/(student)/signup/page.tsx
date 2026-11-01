import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Alert, ButtonLink, Card, PageTitle } from "@/components/ui";
import { getCurrentVoter } from "@/server/auth/current";
import { config } from "@/server/config";
import { getDb } from "@/server/db";
import { getElection } from "@/server/services/election";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = { title: "Register" };

export default async function SignupPage() {
  if (await getCurrentVoter()) redirect("/dashboard");
  const election = await getElection(getDb());

  if (!election || election.status !== "DRAFT") {
    return (
      <Card data-testid="registration-closed">
        <PageTitle>Registration closed</PageTitle>
        <Alert tone="warning">
          {election
            ? "Registration is closed because voting has already started. If you already registered, log in below."
            : "Registration has not opened yet. Please check back later."}
        </Alert>
        <ButtonLink href="/login" className="mt-5 w-full">
          Log in
        </ButtonLink>
      </Card>
    );
  }

  return (
    <Card>
      <PageTitle sub={election.name}>Register to vote</PageTitle>
      <SignupForm registrationPattern={config.registrationPattern} />
      <p className="mt-5 text-center text-sm text-slate-600">
        Already registered?{" "}
        <Link href="/login" className="font-semibold text-indigo-700 underline">
          Log in
        </Link>
      </p>
    </Card>
  );
}
