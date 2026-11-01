"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { PasswordField } from "@/components/password-field";
import { Alert, Button, Field } from "@/components/ui";
import { api } from "@/lib/client-api";

export function LoginForm({ defaultRegistration = "" }: { defaultRegistration?: string }) {
  const router = useRouter();
  const pending = useRef(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending.current) return;
    const form = new FormData(e.currentTarget);
    const registrationNumber = String(form.get("registrationNumber") ?? "");
    const password = String(form.get("password") ?? "");
    if (!registrationNumber.trim() || !password) {
      setError("Enter your registration number and password.");
      return;
    }
    pending.current = true;
    setLoading(true);
    setError(null);
    const res = await api<{ redirect: string }>("/api/auth/login", { body: { registrationNumber, password } });
    if (res.ok) {
      router.replace(res.data.redirect);
      router.refresh();
      return;
    }
    pending.current = false;
    setLoading(false);
    setError(res.error.message);
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {error && <Alert tone="error">{error}</Alert>}
      <Field
        id="registrationNumber"
        label="College registration number"
        autoComplete="username"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="next"
        defaultValue={defaultRegistration}
        required
        maxLength={40}
      />
      <PasswordField id="password" label="Password" autoComplete="current-password" enterKeyHint="go" required maxLength={256} />
      <Button type="submit" loading={loading} className="mt-2 w-full">
        {loading ? "Logging in…" : "Log in"}
      </Button>
    </form>
  );
}
