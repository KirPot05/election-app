import type { ReactNode } from "react";
import { requireAdminPage } from "@/server/auth/current";
import { LogoutButton } from "@/components/logout-button";
import { AdminNav } from "./admin-nav";

export default async function AdminPanelLayout({ children }: { children: ReactNode }) {
  const admin = await requireAdminPage();
  return (
    <>
      <header className="border-b border-slate-200 bg-slate-900 text-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-2">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-slate-300">Election admin</p>
            <p className="truncate text-sm font-semibold" data-testid="admin-username">
              {admin.username}
            </p>
          </div>
          <LogoutButton endpoint="/api/admin/logout" to="/admin/login" />
        </div>
        <AdminNav />
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">{children}</main>
    </>
  );
}
