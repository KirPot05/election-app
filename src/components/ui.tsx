/**
 * Small, dependency-free UI primitives (mobile-first, >= 44px touch targets).
 * shadcn/ui was considered; for this handful of components plain Tailwind
 * keeps the bundle and dependency list smaller.
 */
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

type Variant = "primary" | "secondary" | "danger" | "ghost";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-indigo-700 text-white hover:bg-indigo-800 disabled:bg-indigo-300",
  secondary: "border border-slate-300 bg-white text-slate-900 hover:bg-slate-100 disabled:text-slate-400",
  danger: "bg-red-700 text-white hover:bg-red-800 disabled:bg-red-300",
  ghost: "text-indigo-700 hover:bg-indigo-50 disabled:text-slate-400",
};

export function buttonClass(variant: Variant = "primary", extra = "") {
  return `inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-5 py-3 text-base font-semibold transition-colors disabled:cursor-not-allowed ${VARIANTS[variant]} ${extra}`;
}

export function Button({
  variant = "primary",
  loading = false,
  className = "",
  children,
  disabled,
  ...props
}: ComponentProps<"button"> & { variant?: Variant; loading?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClass(variant, className)}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

export function ButtonLink({
  variant = "primary",
  className = "",
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link {...props} className={buttonClass(variant, className)} />;
}

export function Spinner() {
  return (
    <span
      aria-hidden
      className="inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent"
    />
  );
}

export function Card({ className = "", ...props }: ComponentProps<"section">) {
  return <section {...props} className={`rounded-2xl border border-slate-200 bg-white p-5 shadow-sm ${className}`} />;
}

type Tone = "info" | "success" | "warning" | "error";
const TONES: Record<Tone, string> = {
  info: "border-indigo-200 bg-indigo-50 text-indigo-900",
  success: "border-emerald-300 bg-emerald-50 text-emerald-900",
  warning: "border-amber-300 bg-amber-50 text-amber-900",
  error: "border-red-300 bg-red-50 text-red-900",
};

export function Alert({ tone = "info", title, children, className = "" }: { tone?: Tone; title?: string; children?: ReactNode; className?: string }) {
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-xl border px-4 py-3 text-sm ${TONES[tone]} ${className}`}>
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={title ? "mt-1" : ""}>{children}</div>}
    </div>
  );
}

const BADGES: Record<string, string> = {
  DRAFT: "bg-slate-200 text-slate-800",
  OPEN: "bg-emerald-100 text-emerald-900",
  CLOSED: "bg-amber-100 text-amber-900",
  FINALIZED: "bg-indigo-100 text-indigo-900",
};

export const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Not started",
  OPEN: "Voting open",
  CLOSED: "Voting closed",
  FINALIZED: "Finalized",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span data-testid="election-status" data-status={status} className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ${BADGES[status] ?? BADGES.DRAFT}`}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

export function Field({
  label,
  error,
  hint,
  id,
  ...input
}: ComponentProps<"input"> & { label: string; error?: string; hint?: ReactNode; id: string }) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold text-slate-800">
        {label}
      </label>
      <input
        id={id}
        name={id}
        {...input}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`min-h-12 w-full rounded-xl border bg-white px-4 py-3 text-base text-slate-900 placeholder:text-slate-400 ${error ? "border-red-500" : "border-slate-300"} disabled:bg-slate-100`}
      />
      {hint && (
        <p id={`${id}-hint`} className="text-sm text-slate-600">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-sm font-medium text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

export function PageTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-5">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">{children}</h1>
      {sub && <p className="mt-1 text-base text-slate-600">{sub}</p>}
    </div>
  );
}
