import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Alert, Card, PageTitle } from "@/components/ui";
import { getCurrentVoter } from "@/server/auth/current";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Log in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  if (await getCurrentVoter()) redirect("/dashboard");
  const sp = await searchParams;
  const reset = sp.reset === "1";
  const registration = typeof sp.registration === "string" ? sp.registration.slice(0, 40) : "";

  return (
    <Card>
      <PageTitle>Student login</PageTitle>
      {reset && (
        <Alert tone="success" className="mb-4" title="Password updated">
          Log in with your registration number and new password.
        </Alert>
      )}
      <LoginForm defaultRegistration={registration} />
      <p className="mt-5 text-center text-sm text-slate-600">
        New here?{" "}
        <Link href="/signup" className="font-semibold text-indigo-700 underline">
          Register
        </Link>
      </p>
      <p className="mt-2 text-center text-sm text-slate-600">
        Forgot your password? Ask the election administrator for a reset link.
      </p>
    </Card>
  );
}
