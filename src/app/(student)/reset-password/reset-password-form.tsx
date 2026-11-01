"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { PasswordField } from "@/components/password-field";
import { Alert, Button, Field } from "@/components/ui";
import { api } from "@/lib/client-api";
import { fieldErrors, PASSWORD_MIN, recoverySchema } from "@/lib/validation";

/**
 * The recovery token arrives in the URL fragment (#token). Fragments are
 * never sent to the server, so the token can't end up in access logs. We read
 * it once and remove it from the address bar.
 */
export function ResetPasswordForm() {
  const router = useRouter();
  const pending = useRef(false);
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fromHash = window.location.hash.replace(/^#/, "").trim();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of browser-only state
    if (fromHash) setToken(fromHash);
    if (fromHash) window.history.replaceState(null, "", window.location.pathname);
    setReady(true);
  }, []);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending.current) return;
    const form = new FormData(e.currentTarget);
    const input = {
      token: token ?? String(form.get("token") ?? "").trim(),
      newPassword: String(form.get("newPassword") ?? ""),
      confirmPassword: String(form.get("confirmPassword") ?? ""),
    };
    const local = recoverySchema.safeParse(input);
    setError(null);
    if (!local.success) {
      setErrors(fieldErrors(local.error));
      return;
    }
    setErrors({});
    pending.current = true;
    setLoading(true);
    const res = await api<{ registrationNumber: string }>("/api/auth/recover", { body: input });
    if (res.ok) {
      router.replace(`/login?reset=1&registration=${encodeURIComponent(res.data.registrationNumber)}`);
      return;
    }
    pending.current = false;
    setLoading(false);
    if (res.kind === "error" && res.error.fields) setErrors(res.error.fields);
    setError(res.error.message);
  }

  if (!ready) return <p className="text-slate-600">Loading…</p>;

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {error && <Alert tone="error">{error}</Alert>}
      {token ? (
        <Alert>Recovery link detected. Choose a new password below.</Alert>
      ) : (
        <Field
          id="token"
          label="Recovery code"
          autoComplete="one-time-code"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          error={errors.token}
          hint="Paste the code from the administrator, or open the recovery link directly."
        />
      )}
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
        Set new password
      </Button>
    </form>
  );
}
