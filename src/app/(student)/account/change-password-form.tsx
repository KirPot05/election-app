"use client";

import { useRef, useState, type FormEvent } from "react";
import { PasswordField } from "@/components/password-field";
import { Alert, Button } from "@/components/ui";
import { api } from "@/lib/client-api";
import { changePasswordSchema, fieldErrors, PASSWORD_MIN } from "@/lib/validation";

export function ChangePasswordForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (loading) return;
    const form = new FormData(e.currentTarget);
    const input = {
      currentPassword: String(form.get("currentPassword") ?? ""),
      newPassword: String(form.get("newPassword") ?? ""),
      confirmPassword: String(form.get("confirmPassword") ?? ""),
    };
    const local = changePasswordSchema.safeParse(input);
    setMessage(null);
    if (!local.success) {
      setErrors(fieldErrors(local.error));
      return;
    }
    setErrors({});
    setLoading(true);
    const res = await api("/api/auth/password", { body: input });
    setLoading(false);
    if (res.ok) {
      formRef.current?.reset();
      setMessage({ tone: "success", text: "Password changed. You have been signed out on all other devices." });
      return;
    }
    if (res.kind === "error" && res.error.fields) setErrors(res.error.fields);
    setMessage({ tone: "error", text: res.error.message });
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {message && <Alert tone={message.tone}>{message.text}</Alert>}
      <PasswordField id="currentPassword" label="Current password" autoComplete="current-password" required error={errors.currentPassword} />
      <PasswordField
        id="newPassword"
        label="New password"
        autoComplete="new-password"
        required
        minLength={PASSWORD_MIN}
        error={errors.newPassword}
        hint={`At least ${PASSWORD_MIN} characters.`}
      />
      <PasswordField id="confirmPassword" label="Confirm new password" autoComplete="new-password" required error={errors.confirmPassword} />
      <Button type="submit" loading={loading} className="mt-2 w-full">
        Change password
      </Button>
    </form>
  );
}
