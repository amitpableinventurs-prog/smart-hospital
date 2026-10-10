"use client";

/** Browser-side wrapper around the API's { success, data, error } convention. */

export interface Paged {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export class ApiClientError extends Error {
  constructor(
    public status: number,
    message: string,
    public fields?: Record<string, string>
  ) {
    super(message);
  }
}

export async function api<T>(
  url: string,
  opts: { method?: string; body?: unknown; signal?: AbortSignal } = {}
): Promise<{ data: T; pagination?: Paged }> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? "GET",
      headers: opts.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
      cache: "no-store",
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ApiClientError(0, "Cannot reach the server. Check your connection and try again.");
  }

  let json: { success?: boolean; data?: T; pagination?: Paged; error?: { message?: string; fields?: Record<string, string> } } | null = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON response */
  }

  if (res.status === 401 && !url.startsWith("/api/auth/login")) {
    // Hard navigation on purpose: an expired session should drop all client state.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
  }
  if (!res.ok || !json?.success) {
    throw new ApiClientError(res.status, json?.error?.message ?? `Request failed (${res.status})`, json?.error?.fields);
  }
  return { data: json.data as T, pagination: json.pagination };
}

export function qs(params: Record<string, string | number | undefined | null>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}
