"use client";

import { Plus, Search, Truck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { qs } from "@/lib/client";
import { formatDate, formatMoney } from "@/lib/format";
import { useApiQuery } from "@/lib/useApi";
import { Badge, Button, Card, EmptyState, ErrorState, Kbd, PageHeader, Pagination, Spinner, cx, inputClass, statusTone, useDebounced, useHotkeys } from "../ui";

interface SaleRow {
  id: string;
  code: string;
  billDate: string;
  customerName: string;
  customerPhone?: string;
  doctorName?: string;
  paymentMode: string;
  netAmount: number;
  paidAmount: number;
  status: string;
  createdByName?: string;
}
interface PurchaseRow {
  id: string;
  code: string;
  supplierName: string;
  supplierInvoiceNo: string;
  invoiceDate: string;
  netAmount: number;
  status: string;
  lines: number;
  createdByName?: string;
}

type Tab = "sales" | "purchases";

export function PharmacyHome({ initialTab }: { initialTab: Tab }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const debounced = useDebounced(search);
  const searchRef = useRef<HTMLInputElement>(null);

  const url = `/api/pharmacy/${tab}${qs({ search: debounced, from, to, status, page })}`;
  const q = useApiQuery<(SaleRow | PurchaseRow)[]>(url);
  const rows = q.data ?? [];

  useHotkeys({
    F2: () => router.push("/pharmacy/new"),
    F4: () => router.push("/pharmacy/purchases/new"),
    F3: () => searchRef.current?.focus(),
  });

  function switchTab(t: Tab) {
    setTab(t);
    setStatus("");
    setPage(1);
    history.replaceState(null, "", `?tab=${t}`);
  }
  const reset = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(1);
  };

  return (
    <>
      <PageHeader
        title="Pharmacy"
        description="Sale bills and purchase entries — stock moves batch-wise automatically."
        actions={
          <>
            <Link href="/pharmacy/purchases/new"><Button variant="secondary"><Truck className="size-4" /> Purchase entry <Kbd>F4</Kbd></Button></Link>
            <Link href="/pharmacy/new"><Button><Plus className="size-4" /> New sale bill <Kbd>F2</Kbd></Button></Link>
          </>
        }
      />

      <div className="mb-4 flex gap-1 border-b border-slate-200" role="tablist">
        {(["sales", "purchases"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => switchTab(t)}
            className={cx("-mb-px border-b-2 px-4 py-2.5 text-sm font-medium", tab === t ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-800")}
          >
            {t === "sales" ? "Sale Bills" : "Purchase Entries"}
          </button>
        ))}
      </div>

      <Card>
        <div className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-2 lg:grid-cols-5">
          <div className="relative lg:col-span-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <input ref={searchRef} value={search} onChange={(e) => reset(setSearch)(e.target.value)} placeholder={tab === "sales" ? "Bill no., customer, phone, doctor…  (F3)" : "Entry no., supplier, invoice no…  (F3)"} className={cx(inputClass, "pl-9")} aria-label="Search" />
          </div>
          <input type="date" value={from} max={to || undefined} onChange={(e) => reset(setFrom)(e.target.value)} className={inputClass} aria-label="From date" />
          <input type="date" value={to} min={from || undefined} onChange={(e) => reset(setTo)(e.target.value)} className={inputClass} aria-label="To date" />
          <select value={status} onChange={(e) => reset(setStatus)(e.target.value)} className={inputClass} aria-label="Status">
            <option value="">All statuses</option>
            {(tab === "sales" ? ["Paid", "Partially Paid", "Unpaid", "Cancelled"] : ["Received", "Cancelled"]).map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>

        {q.loading ? (
          <Spinner />
        ) : q.error ? (
          <ErrorState message={q.error} onRetry={q.reload} />
        ) : rows.length === 0 ? (
          <EmptyState
            title={tab === "sales" ? "No sale bills" : "No purchase entries"}
            description={tab === "sales" ? "Stock items via a purchase entry first, then create bills with F2." : "Record supplier invoices to bring stock in (F4)."}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead className="bg-slate-50/60 text-xs uppercase tracking-wide text-slate-500">
                {tab === "sales" ? (
                  <tr>{["Bill #", "Date", "Customer", "Doctor", "Mode", "Amount", "Paid", "Status", "By"].map((h) => <th key={h} className="whitespace-nowrap px-4 py-3 text-left font-semibold">{h}</th>)}</tr>
                ) : (
                  <tr>{["Entry #", "Invoice date", "Supplier", "Invoice no.", "Items", "Amount", "Status", "By"].map((h) => <th key={h} className="whitespace-nowrap px-4 py-3 text-left font-semibold">{h}</th>)}</tr>
                )}
              </thead>
              <tbody className="divide-y divide-slate-100">
                {tab === "sales"
                  ? (rows as SaleRow[]).map((r) => (
                      <tr key={r.id} onClick={() => router.push(`/pharmacy/sales/${r.id}`)} className="cursor-pointer hover:bg-brand-50/40">
                        <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-brand-700">{r.code}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">{formatDate(r.billDate)}</td>
                        <td className="whitespace-nowrap px-4 py-2.5"><span className="font-medium text-slate-900">{r.customerName}</span>{r.customerPhone && <span className="ml-2 text-xs text-slate-500">{r.customerPhone}</span>}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">{r.doctorName ?? "—"}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">{r.paymentMode}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-slate-900">{formatMoney(r.netAmount)}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-slate-600">{formatMoney(r.paidAmount)}</td>
                        <td className="whitespace-nowrap px-4 py-2.5"><Badge tone={statusTone(r.status)}>{r.status}</Badge></td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-xs text-slate-500">{r.createdByName ?? "—"}</td>
                      </tr>
                    ))
                  : (rows as PurchaseRow[]).map((r) => (
                      <tr key={r.id} onClick={() => router.push(`/pharmacy/purchases/${r.id}`)} className="cursor-pointer hover:bg-brand-50/40">
                        <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-brand-700">{r.code}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">{formatDate(r.invoiceDate)}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 font-medium text-slate-900">{r.supplierName}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-slate-600">{r.supplierInvoiceNo}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-slate-600">{r.lines}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-slate-900">{formatMoney(r.netAmount)}</td>
                        <td className="whitespace-nowrap px-4 py-2.5"><Badge tone={r.status === "Cancelled" ? "red" : "green"}>{r.status}</Badge></td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-xs text-slate-500">{r.createdByName ?? "—"}</td>
                      </tr>
                    ))}
              </tbody>
            </table>
          </div>
        )}
        {!q.loading && !q.error && <Pagination pagination={q.pagination} onPage={setPage} />}
      </Card>
    </>
  );
}
