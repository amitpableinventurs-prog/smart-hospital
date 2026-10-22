"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { InvoiceDocument } from "@/components/control/Invoice";
import { ApiClientError, api } from "@/lib/client";
import type { InvoiceView } from "@/lib/control-shared";

/** The hospital's copy of a licence invoice, fetched from the vendor (needs the internet). */
export default function LicenceInvoicePage() {
  const { id } = useParams<{ id: string }>();
  const [nonce, setNonce] = useState(0);
  const [result, setResult] = useState<{ key: string; data?: InvoiceView; error?: string; status?: number } | null>(null);
  const key = `${id}:${nonce}`;
  useEffect(() => {
    let live = true;
    api<InvoiceView>("/api/licence/renewal", { method: "POST", body: { action: "invoice", id } })
      .then(({ data }) => live && setResult({ key, data }))
      .catch((e) => live && setResult({ key, error: (e as Error).message, status: e instanceof ApiClientError ? e.status : 0 }));
    return () => {
      live = false;
    };
  }, [id, key]);
  const current = result?.key === key ? result : null;
  return <InvoiceDocument data={current?.data} error={current?.error} status={current?.status} onRetry={() => setNonce((n) => n + 1)} backHref="/super-admin/licence" backLabel="Licence & Sync" />;
}
