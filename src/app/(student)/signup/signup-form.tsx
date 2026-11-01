"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { PasswordField } from "@/components/password-field";
import { Alert, Button, Field } from "@/components/ui";
import { api } from "@/lib/client-api";
import { fieldErrors, PASSWORD_MIN, signupSchema } from "@/lib/validation";

export function SignupForm({ registrationPattern }: { registrationPattern: string }) {
  const router = useRouter();
  const pending = useRef(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<{ message: string; code?: string } | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending.current) return;
    const form = new FormData(e.currentTarget);
    const input = {
      fullName: String(form.get("fullName") ?? ""),
      registrationNumber: String(form.get("registrationNumber") ?? ""),
      password: String(form.get("password") ?? ""),
    };
    const local = signupSchema(registrationPattern).safeParse(input);
    if (!local.success) {
      setErrors(fieldErrors(local.error));
      setFormError(null);
      return;
    }
    setErrors({});
    setFormError(null);
    pending.current = true;
    setLoading(true);
    const res = await api<{ redirect: string }>("/api/auth/signup", { body: input });
    if (res.ok) {
      router.replace(res.data.redirect);
      router.refresh();
      return; // keep the button disabled while navigating
    }
    pending.current = false;
    setLoading(false);
    if (res.kind === "error" && res.error.fields) setErrors(res.error.fields);
    setFormError({ message: res.error.message, code: res.error.code });
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {formError && (
        <Alert tone="error">
          {formError.message}
          {formError.code === "DUPLICATE_REGISTRATION" && (
            <>
              {" "}
              <Link href="/login" className="font-semibold underline">
                Go to login
              </Link>
            </>
          )}
        </Alert>
      )}
      <Field
        id="fullName"
        label="Full name"
        autoComplete="name"
        autoCapitalize="words"
        enterKeyHint="next"
        required
        maxLength={100}
        error={errors.fullName}
      />
      <Field
        id="registrationNumber"
        label="College registration number"
        autoComplete="username"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="next"
        required
        maxLength={40}
        error={errors.registrationNumber}
        hint="Exactly as on your college ID card. You will use it to log in."
      />
      <PasswordField
        id="password"
        label="Password"
        autoComplete="new-password"
        enterKeyHint="go"
        required
        minLength={PASSWORD_MIN}
        maxLength={256}
        error={errors.password}
        hint={`At least ${PASSWORD_MIN} characters. A passphrase is great.`}
      />
      <Button type="submit" loading={loading} className="mt-2 w-full">
        {loading ? "Registering…" : "Register"}
      </Button>
    </form>
  );
}
