"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui";
import { api } from "@/lib/client-api";

/**
 * Lightweight HTTP polling (no WebSockets): while the page is visible, ask
 * the server for the current screen every few seconds and re-render the page
 * from the server when it changes (e.g. the administrator opened voting).
 */
export function StatusPoller({ screen, intervalMs = 7000, quiet = false }: { screen: string; intervalMs?: number; quiet?: boolean }) {
  const router = useRouter();
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let active = true;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      const res = await api<{ screen: string }>("/api/student/status", { timeoutMs: 8000 });
      if (!active) return;
      if (res.ok) {
        setOffline(false);
        setLastChecked(new Date());
        if (res.data.screen !== screen) router.refresh();
      } else if (res.kind === "error" && res.status === 401) {
        router.refresh(); // session ended -> the page will redirect to login
      } else {
        setOffline(true);
      }
    };
    const id = setInterval(tick, intervalMs);
    document.addEventListener("visibilitychange", tick);
    return () => {
      active = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [screen, intervalMs, router]);

  if (quiet) return null;
  return (
    <div className="mt-4 flex flex-col gap-2">
      <Button variant="secondary" onClick={() => router.refresh()} className="w-full">
        Refresh status
      </Button>
      <p className="text-center text-xs text-slate-500" aria-live="polite">
        {offline
          ? "Connection problem. Retrying automatically…"
          : lastChecked
            ? `Last checked ${lastChecked.toLocaleTimeString()}`
            : "Checking automatically every few seconds."}
      </p>
    </div>
  );
}
