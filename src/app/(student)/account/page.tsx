import type { Metadata } from "next";
import Link from "next/link";
import { Card, PageTitle } from "@/components/ui";
import { requireVoterPage } from "@/server/auth/current";
import { ChangePasswordForm } from "./change-password-form";

export const metadata: Metadata = { title: "Change password" };

export default async function AccountPage() {
  const voter = await requireVoterPage();
  return (
    <div className="flex flex-col gap-4">
      <Link href="/dashboard" className="inline-flex min-h-11 items-center text-sm font-semibold text-indigo-700 underline">
        ← Back to dashboard
      </Link>
      <Card>
        <PageTitle sub={`${voter.fullName} · ${voter.registrationNumber}`}>Change password</PageTitle>
        <ChangePasswordForm />
      </Card>
    </div>
  );
}
