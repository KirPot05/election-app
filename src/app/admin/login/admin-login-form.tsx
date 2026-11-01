"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { PasswordField } from "@/components/password-field";
import { Alert, Button, Field } from "@/components/ui";
import { api } from "@/lib/client-api";

export function AdminLoginForm() {
  const router = useRouter();
  const pending = useRef(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending.current) return;
    const form = new FormData(e.currentTarget);
    pending.current = true;
    setLoading(true);
    setError(null);
    const res = await api<{ redirect: string }>("/api/admin/login", {
      body: { username: String(form.get("username") ?? ""), password: String(form.get("password") ?? "") },
    });
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
      <Field id="username" label="Username" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} required />
      <PasswordField id="password" label="Password" autoComplete="current-password" required />
      <Button type="submit" loading={loading} className="mt-2 w-full">
        Log in
      </Button>
    </form>
  );
}
