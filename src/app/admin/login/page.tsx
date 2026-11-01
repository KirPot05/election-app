import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageTitle } from "@/components/ui";
import { getCurrentAdmin } from "@/server/auth/current";
import { AdminLoginForm } from "./admin-login-form";

export const metadata: Metadata = { title: "Administrator login" };

export default async function AdminLoginPage() {
  if (await getCurrentAdmin()) redirect("/admin");
  return (
    <main className="mx-auto w-full max-w-md flex-1 px-4 py-8">
      <Card>
        <PageTitle sub="Election administrators only.">Administrator login</PageTitle>
        <AdminLoginForm />
      </Card>
      <p className="mt-4 text-center">
        <Link href="/" className="inline-flex min-h-11 items-center text-sm text-slate-600 underline">
          Student portal
        </Link>
      </p>
    </main>
  );
}
