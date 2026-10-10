"use client";

import { ArrowLeft, Ban, Plus } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { CancelModal } from "@/components/pharmacy/CancelModal";
import { Alert, Badge, Button, Card, CardHeader, EmptyState, ErrorState, Spinner, useToast } from "@/components/ui";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { useApiQuery } from "@/lib/useApi";

interface Purchase {
  id: string;
  code: string;
  supplier: string;
  supplierName: string;
  supplierInvoiceNo: string;
  invoiceDate: string;
  items: { itemName: string; batchNo: string; expiryDate: string | null; qty: number; freeQty: number; purchaseRate: number; mrp: number; discountPct: number; gstRate: number; taxable: number; gst: number; amount: number }[];
  taxableTotal: number;
  gstTotal: number;
  roundOff: number;
  netAmount: number;
  status: string;
  notes?: string;
  cancelReason?: string;
  cancelledAt?: string;
  createdByName?: string;
  createdAt: string;
}

export default function PurchasePage() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const q = useApiQuery<Purchase>(`/api/pharmacy/purchases/${id}`);
  const [updated, setUpdated] = useState<Purchase | null>(null);
  const p = updated?.id === id ? updated : q.data;
  const [cancelling, setCancelling] = useState(false);

  const back = (
    <Link href="/pharmacy?tab=purchases" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
      <ArrowLeft className="size-4" /> Back to purchases
    </Link>
  );
  if (q.error) return <>{back}<Card>{q.status === 404 ? <EmptyState title="Purchase not found" /> : <ErrorState message={q.error} onRetry={q.reload} />}</Card></>;
  if (!p) return <>{back}<Spinner label="Loading purchase…" /></>;

  return (
    <>
      {back}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold text-slate-900">Purchase {p.code}</h1>
            <Badge tone={p.status === "Cancelled" ? "red" : "green"}>{p.status}</Badge>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {p.supplierName} · Invoice <span className="font-mono">{p.supplierInvoiceNo}</span> dated {formatDate(p.invoiceDate)} · entered by {p.createdByName ?? "—"} {formatDateTime(p.createdAt)}
          </p>
        </div>
        <div className="flex gap-2">
          {p.status !== "Cancelled" && <Button variant="secondary" className="text-red-600" onClick={() => setCancelling(true)}><Ban className="size-4" /> Cancel entry</Button>}
          <Link href="/pharmacy/purchases/new"><Button><Plus className="size-4" /> New purchase</Button></Link>
        </div>
      </div>
      {p.status === "Cancelled" && <div className="mb-4"><Alert tone="amber">Cancelled {formatDateTime(p.cancelledAt)} — stock reversed. Reason: {p.cancelReason}</Alert></div>}

      <Card>
        <CardHeader title={`${p.items.length} item${p.items.length === 1 ? "" : "s"} received`} description="Rates exclude GST" />
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead className="bg-slate-50/60 text-xs uppercase tracking-wide text-slate-500">
              <tr>{["Item", "Batch", "Expiry", "Qty", "Free", "Rate", "MRP", "Disc %", "GST %", "Taxable", "GST", "Amount"].map((h) => <th key={h} className="whitespace-nowrap px-3 py-2.5 text-left font-semibold">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100 tabular-nums">
              {p.items.map((l, i) => (
                <tr key={i}>
                  <td className="px-3 py-2 font-medium text-slate-900">{l.itemName}</td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-600">{l.batchNo}</td>
                  <td className="px-3 py-2 text-slate-600">{formatDate(l.expiryDate)}</td>
                  <td className="px-3 py-2">{l.qty}</td>
                  <td className="px-3 py-2 text-slate-500">{l.freeQty || "—"}</td>
                  <td className="px-3 py-2">{l.purchaseRate.toFixed(2)}</td>
                  <td className="px-3 py-2">{l.mrp.toFixed(2)}</td>
                  <td className="px-3 py-2 text-slate-500">{l.discountPct || "—"}</td>
                  <td className="px-3 py-2">{l.gstRate}</td>
                  <td className="px-3 py-2">{l.taxable.toFixed(2)}</td>
                  <td className="px-3 py-2">{l.gst.toFixed(2)}</td>
                  <td className="px-3 py-2 font-medium text-slate-900">{l.amount.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <dl className="ml-auto max-w-xs space-y-1 border-t border-slate-100 p-5 text-sm tabular-nums">
          <div className="flex justify-between"><dt className="text-slate-600">Taxable</dt><dd>{p.taxableTotal.toFixed(2)}</dd></div>
          <div className="flex justify-between"><dt className="text-slate-600">GST</dt><dd>{p.gstTotal.toFixed(2)}</dd></div>
          <div className="flex justify-between"><dt className="text-slate-600">Round off</dt><dd>{p.roundOff.toFixed(2)}</dd></div>
          <div className="flex justify-between border-t border-slate-200 pt-1 text-base font-bold"><dt>Total</dt><dd>{formatMoney(p.netAmount)}</dd></div>
        </dl>
        {p.notes && <p className="border-t border-slate-100 px-5 py-3 text-sm text-slate-600">Note: {p.notes}</p>}
      </Card>

      {cancelling && (
        <CancelModal
          url={`/api/pharmacy/purchases/${p.id}/cancel`}
          label={`purchase ${p.code}`}
          note="Stock added by this entry will be removed. Not possible if some of it has already been sold."
          onClose={() => setCancelling(false)}
          onDone={(d) => { setUpdated(d as Purchase); setCancelling(false); toast("Purchase cancelled — stock reversed"); }}
        />
      )}
    </>
  );
}
