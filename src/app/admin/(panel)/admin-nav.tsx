"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/election", label: "Election" },
  { href: "/admin/candidates", label: "Candidates" },
  { href: "/admin/students", label: "Students" },
  { href: "/admin/audit", label: "Audit" },
] as const;

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Admin sections" className="mx-auto max-w-3xl px-2 pb-2">
      <ul className="grid grid-cols-3 gap-1 sm:grid-cols-5">
        {TABS.map((t) => {
          const active = t.href === "/admin" ? pathname === "/admin" : pathname.startsWith(t.href);
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-11 items-center justify-center rounded-lg px-2 text-sm font-semibold ${
                  active ? "bg-white text-slate-900" : "text-slate-200 hover:bg-slate-800"
                }`}
              >
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
