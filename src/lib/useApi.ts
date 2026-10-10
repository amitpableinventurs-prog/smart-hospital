"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiClientError, api, type Paged } from "./client";

interface Result<T> {
  key: string;
  data?: T;
  pagination?: Paged;
  error?: string;
  status?: number;
}

/**
 * Fetch `url` and re-fetch whenever it changes or `reload()` is called.
 * Loading is derived (the latest result belongs to a different request),
 * so stale responses from aborted requests are never shown.
 */
export function useApiQuery<T>(url: string | null) {
  const [nonce, setNonce] = useState(0);
  const key = url ? `${url}::${nonce}` : "";
  const [result, setResult] = useState<Result<T> | null>(null);

  useEffect(() => {
    if (!url) return;
    const ctrl = new AbortController();
    api<T>(url, { signal: ctrl.signal })
      .then(({ data, pagination }) => setResult({ key, data, pagination }))
      .catch((e) => {
        if ((e as Error).name === "AbortError") return;
        setResult({ key, error: (e as Error).message, status: e instanceof ApiClientError ? e.status : 0 });
      });
    return () => ctrl.abort();
  }, [url, key]);

  const current = result?.key === key ? result : null;
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return {
    data: current?.data,
    pagination: current?.pagination,
    error: current?.error ?? null,
    status: current?.status,
    loading: !!url && !current,
    /** Last successful data, even while a refresh is in flight. */
    stale: result?.data,
    reload,
  };
}
