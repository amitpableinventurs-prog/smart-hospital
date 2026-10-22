"use client";

import { useParams } from "next/navigation";
import { VoucherForm } from "@/components/accounts/VoucherForm";
import type { Voucher } from "@/components/accounts/types";
import { Card, ErrorState, Spinner } from "@/components/ui";
import { useApiQuery } from "@/lib/useApi";

export default function EditVoucherPage() {
  const { id } = useParams<{ id: string }>();
  const q = useApiQuery<Voucher>(`/api/accounts/vouchers/${id}`);
  if (q.error) return <Card><ErrorState message={q.error} onRetry={q.reload} /></Card>;
  if (!q.data) return <Spinner label="Loading voucher…" />;
  if (q.data.auto || q.data.status !== "Active") return <Card><ErrorState message="Only active vouchers entered in Accounts can be edited." /></Card>;
  return <VoucherForm key={q.data.id} voucher={q.data} />;
}
