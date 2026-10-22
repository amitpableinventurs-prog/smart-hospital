"use client";

import { IndianRupee, Search } from "lucide-react";
import { useState } from "react";
import { PaymentsTable } from "@/components/control/Payments";
import { Card, EmptyState, ErrorState, PageHeader, Pagination, Spinner, StatCard, cx, inputClass, useDebounced } from "@/components/ui";
import { qs } from "@/lib/client";
import { PAYMENT_METHODS, PAYMENT_STATUSES, type PaymentRow } from "@/lib/control-shared";
import { formatMoney } from "@/lib/format";
import { useApiQuery } from "@/lib/useApi";

type Totals = { paid: number; taxable: number; gst: number; total: number; commission: number; commissionDue: number };

/** Control Panel: every licence payment — online from hospitals' apps and recorded by hand. */
export default function SubscriptionsPage() {
  const [search, setSearch] = useState("");
  const [f, setF] = useState({ status: "", method: "", from: "", to: "" });
  const [page, setPage] = useState(1);
  const debounced = useDebounced(search);
  const q = useApiQuery<{ rows: PaymentRow[]; totals: Totals }>(`/api/control/payments${qs({ search: debounced, ...f, page })}`);
  const d = q.data ?? q.stale;
  const setFilter = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setF((s) => ({ ...s, [k]: e.target.value }));
    setPage(1);
  };

  return (
    <>
      <PageHeader title="Licence Payments" description="Plan purchases and renewals. Online payments come from the hospital's own app into the Razorpay account under Payment Gateway; record cash, UPI or bank payments on the client's page." />
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <StatCard label="Received (incl. GST)" value={formatMoney(d?.totals.total ?? 0)} icon={<IndianRupee className="size-5" />} hint={`${d?.totals.paid ?? 0} payment(s) in this view`} />
        <StatCard label="Revenue before GST" value={formatMoney(d?.totals.taxable ?? 0)} tone="slate" />
        <StatCard label="GST collected" value={formatMoney(d?.totals.gst ?? 0)} tone="slate" />
        <StatCard label="Partner commission due" value={formatMoney(d?.totals.commissionDue ?? 0)} tone={(d?.totals.commissionDue ?? 0) > 0 ? "amber" : "slate"} hint={`of ${formatMoney(d?.totals.commission ?? 0)} earned`} />
      </div>
      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 lg:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Hospital, invoice no., reference or coupon…" className={cx(inputClass, "pl-9")} aria-label="Search payments" />
          </div>
          <select value={f.status} onChange={setFilter("status")} className={cx(inputClass, "lg:w-40")} aria-label="Status"><option value="">Any status</option>{PAYMENT_STATUSES.map((s) => <option key={s} value={s}>{s === "Created" ? "Not completed" : s}</option>)}</select>
          <select value={f.method} onChange={setFilter("method")} className={cx(inputClass, "lg:w-40")} aria-label="Method"><option value="">Any method</option>{PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}</select>
          <input type="date" value={f.from} onChange={setFilter("from")} className={cx(inputClass, "lg:w-40")} aria-label="From" />
          <input type="date" value={f.to} onChange={setFilter("to")} className={cx(inputClass, "lg:w-40")} aria-label="To" />
        </div>
        {q.error && !d ? (
          <ErrorState message={q.error} onRetry={q.reload} />
        ) : !d ? (
          <Spinner label="Loading payments…" />
        ) : d.rows.length === 0 ? (
          <EmptyState title="No payments" description="Payments appear here when a hospital renews in its app or you record one on a client's page." />
        ) : (
          <>
            <PaymentsTable rows={d.rows} onChanged={q.reload} />
            <Pagination pagination={q.pagination} onPage={setPage} />
          </>
        )}
      </Card>
    </>
  );
}
