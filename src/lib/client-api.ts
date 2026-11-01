/**
 * Browser-side JSON API helper. Distinguishes three outcomes so the UI can
 * react correctly on flaky mobile networks:
 *   - ok:     the server answered 2xx
 *   - error:  the server answered with a known error (it definitely rejected)
 *   - network: no answer (the request may or may not have reached the server)
 */
export type ApiError = { code: string; message: string; fields?: Record<string, string> };

export type ApiResult<T> =
  | { ok: true; data: T; status: number }
  | { ok: false; kind: "error"; error: ApiError; status: number }
  | { ok: false; kind: "network"; error: ApiError };

const NETWORK_ERROR: ApiError = {
  code: "NETWORK",
  message: "We couldn't reach the server. Check your connection and try again.",
};

export async function api<T = unknown>(
  path: string,
  opts: { method?: string; body?: unknown; timeoutMs?: number } = {},
): Promise<ApiResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20_000);
  try {
    const res = await fetch(path, {
      method: opts.method ?? (opts.body === undefined ? "GET" : "POST"),
      headers: opts.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    });
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (res.ok) return { ok: true, data: data as T, status: res.status };
    const error = (data as { error?: ApiError } | null)?.error;
    if (!error) {
      // e.g. a proxy/gateway error page: treat as "no reliable answer".
      return { ok: false, kind: "network", error: NETWORK_ERROR };
    }
    return { ok: false, kind: "error", error, status: res.status };
  } catch {
    return { ok: false, kind: "network", error: NETWORK_ERROR };
  } finally {
    clearTimeout(timer);
  }
}
