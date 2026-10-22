"use client";

import { useParams } from "next/navigation";
import { InvoiceDocument } from "@/components/control/Invoice";
import type { InvoiceView } from "@/lib/control-shared";
import { useApiQuery } from "@/lib/useApi";

export default function InvoicePage() {
  const { id } = useParams<{ id: string }>();
  const q = useApiQuery<InvoiceView>(`/api/control/payments/${id}`);
  return <InvoiceDocument data={q.data} error={q.error} status={q.status} onRetry={q.reload} backHref="/super-admin/subscriptions" backLabel="Licence payments" />;
}
