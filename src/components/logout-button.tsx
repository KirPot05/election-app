"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { api } from "@/lib/client-api";

export function LogoutButton({ endpoint = "/api/auth/logout", to = "/login" }: { endpoint?: string; to?: string }) {
  const [loading, setLoading] = useState(false);
  return (
    <Button
      variant="secondary"
      loading={loading}
      className="min-h-11 px-4 py-2 text-sm"
      onClick={async () => {
        setLoading(true);
        await api(endpoint, { body: {} });
        // Full navigation clears all client-side state.
        window.location.assign(to);
      }}
    >
      Log out
    </Button>
  );
}
