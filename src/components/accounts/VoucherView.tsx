"use client";

import { ArrowLeft, Ban, ExternalLink, Pencil, Printer } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { amountInWords } from "@/lib/billing-math";
import { api } from "@/lib/client";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { useApiQuery } from "@/lib/useApi";
import { Info } from "../DetailBits";
import { FormModal } from "../FormModal";
import { Alert, Badge, Button, Card, CardHeader, EmptyState, ErrorState, PageHeader, Spinner, useToast } from "../ui";
import { VOUCHER_TONE, type Voucher } from "./types";

export function VoucherView({ id }: { id: string }) {
  const toast = useToast();
  const q = useApiQuery<Voucher>(`/api/accounts/vouchers/${id}`);
  const [override, setOverride] = useState<Voucher | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const v = override?.id === id ? override : q.data;

  if (q.error && !v) return <Card>{q.status === 404 ? <EmptyState title="Voucher not found" description={q.error} /> : <ErrorState message={q.error} onRetry={q.reload} />}</Card>;
  if (!v) return <Spinner label="Loading voucher…" />;

  const editable = !v.auto && v.status === "Active";
  return (
    <>
      <PageHeader
        title={`${v.type} voucher ${v.code}`}
        description={v.narration || undefined}
        actions={
          <div className="flex flex-wrap gap-2 print:hidden">
            <Link href="/m/accounts?tab=daybook"><Button variant="secondary"><ArrowLeft className="size-4" /> Day Book</Button></Link>
            <Button variant="secondary" onClick={() => window.print()}><Printer className="size-4" /> Print</Button>
            {editable && <Link href={`/accounts/vouchers/${v.id}/edit`}><Button variant="secondary"><Pencil className="size-4" /> Edit</Button></Link>}
            {editable && <Button variant="danger" onClick={() => setCancelling(true)}><Ban className="size-4" /> Cancel</Button>}
          </div>
        }
      />
      {v.status === "Cancelled" && <div className="mb-4"><Alert>Cancelled{v.cancelledByName ? ` by ${v.cancelledByName}` : ""}: {v.cancelReason}</Alert></div>}
      {v.auto && v.source && (
        <div className="mb-4 print:hidden">
          <Alert tone="amber">
            Posted automatically from {v.source.label.toLowerCase()} {v.source.code}. It changes with its source document and cannot be edited here.
            {v.source.href && <Link href={v.source.href} className="ml-2 inline-flex items-center gap-1 font-medium underline">Open source <ExternalLink className="size-3.5" /></Link>}
          </Alert>
        </div>
      )}
      <Card>
        <CardHeader title={v.code} actions={<Badge tone={VOUCHER_TONE[v.type] ?? "slate"}>{v.type}</Badge>} />
        <dl className="grid gap-4 border-b border-slate-100 p-5 sm:grid-cols-4">
          <Info label="Date" value={formatDate(v.date)} />
          <Info label="Amount" value={formatMoney(v.amount)} />
          <Info label="Reference" value={v.refNo} />
          <Info label="Entered by" value={v.auto ? "Automatic posting" : `${v.createdByName ?? "—"}${v.createdAt ? ` · ${formatDateTime(v.createdAt)}` : ""}`} />
        </dl>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead className="bg-slate-50/60">
              <tr>{["Particulars", "Debit", "Credit"].map((h, i) => <th key={h} className={`px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 ${i ? "text-right" : "text-left"}`}>{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {v.entries.map((e, i) => (
                <tr key={i}>
                  <td className="px-5 py-2.5">
                    <Link href={`/m/accounts?tab=ledger&ledger=${e.ledgerId}`} className={`font-medium text-slate-900 hover:text-brand-700 hover:underline ${e.cr > 0 ? "pl-6" : ""}`}>{e.cr > 0 ? "To " : ""}{e.ledger}</Link>
                    {e.note && <span className="block text-xs text-slate-500">{e.note}</span>}
                  </td>
                  <td className="px-5 py-2.5 text-right tabular-nums">{e.dr ? formatMoney(e.dr) : ""}</td>
                  <td className="px-5 py-2.5 text-right tabular-nums">{e.cr ? formatMoney(e.cr) : ""}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-200 font-semibold">
                <td className="px-5 py-2.5 text-xs font-normal text-slate-500">{amountInWords(v.amount)}</td>
                <td className="px-5 py-2.5 text-right tabular-nums">{formatMoney(v.amount)}</td>
                <td className="px-5 py-2.5 text-right tabular-nums">{formatMoney(v.amount)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        {v.narration && <p className="border-t border-slate-100 px-5 py-3 text-sm text-slate-600"><span className="font-medium text-slate-900">Narration: </span>{v.narration}</p>}
      </Card>
      {cancelling && (
        <FormModal
          title={`Cancel voucher ${v.code}`}
          description="The voucher stays in the day book as cancelled and no longer counts in any balance."
          fields={[{ name: "reason", label: "Reason", type: "textarea", required: true, maxLength: 300 }]}
          confirmLabel="Cancel voucher"
          danger
          onClose={() => setCancelling(false)}
          onSubmit={async (values) => {
            const { data } = await api<Voucher>(`/api/accounts/vouchers/${v.id}/cancel`, { method: "POST", body: { reason: values.reason } });
            setOverride(data);
            setCancelling(false);
            toast(`Voucher ${data.code} cancelled`);
          }}
        />
      )}
    </>
  );
}
