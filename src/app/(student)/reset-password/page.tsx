import type { Metadata } from "next";
import { Card, PageTitle } from "@/components/ui";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = { title: "Set a new password" };

export default function ResetPasswordPage() {
  return (
    <Card>
      <PageTitle sub="Use the one-time link the election administrator gave you.">Set a new password</PageTitle>
      <ResetPasswordForm />
    </Card>
  );
}
