"use client";

import { FileSpreadsheet, Printer } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { qs } from "@/lib/client";
import { downloadCsv } from "@/lib/csv";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { REPORT_TABS, type ReportKey } from "@/lib/report-tabs";
import { useApiQuery } from "@/lib/useApi";
import { Badge, Button, Card, EmptyState, ErrorState, Kbd, PageHeader, Spinner, StatCard, cx, inputClass, statusTone, useDebounced, useHotkeys } from "./ui";

const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => `${today().slice(0, 8)}01`;
const money = (n: number) => n.toFixed(2);

export function ReportsView({ initialTab }: { initialTab: ReportKey }) {
  const [tab, setTab] = useState<ReportKey>(initialTab);
  useHotkeys({ "ctrl+p": () => window.print(), ...Object.fromEntries(REPORT_TABS.map((t, i) => [`alt+${i + 1}`, () => select(t.key)])) });

  function select(t: ReportKey) {
    setTab(t);
    history.replaceState(null, "", `?tab=${t}`);
  }

  return (
    <>
      <div className="print:hidden">
        <PageHeader title="Reports" description="Pharmacy, lab, billing and stock reports. Alt+1…5 switches report, Ctrl+P prints." />
        <div className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200" role="tablist">
          {REPORT_TABS.map((t, i) => (
            <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => select(t.key)}
              className={cx("-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium", tab === t.key ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-800")}>
              {t.label} <Kbd className="ml-1">Alt+{i + 1}</Kbd>
            </button>
          ))}
        </div>
      </div>
      {tab === "daybook" && <DayBook />}
      {tab === "sales-register" && <SalesRegister />}
      {tab === "stock" && <StockReport />}
      {tab === "expiry" && <ExpiryReport />}
      {tab === "outstanding" && <Outstanding />}
    </>
  );
}

function Toolbar({ title, children, onCsv }: { title: string; children?: ReactNode; onCsv?: () => void }) {
  return (
    <>
      <h2 className="mb-3 hidden text-lg font-bold print:block">{title}</h2>
      <div className="mb-4 flex flex-wrap items-end gap-3 print:hidden">
        {children}
        <div className="ml-auto flex gap-2">
          {onCsv && <Button variant="secondary" onClick={onCsv}><FileSpreadsheet className="size-4" /> Export CSV</Button>}
          <Button variant="secondary" onClick={() => window.print()}><Printer className="size-4" /> Print</Button>
        </div>
      </div>
    </>
  );
}

function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return <label className="text-xs font-medium text-slate-600">{label}<div className="mt-1">{children}</div></label>;
}

function State<T>({ q, children }: { q: { loading: boolean; error: string | null; data?: T; reload: () => void }; children: (d: T) => ReactNode }) {
  if (q.loading) return <Spinner label="Preparing report…" />;
  if (q.error) return <Card><ErrorState message={q.error} onRetry={q.reload} /></Card>;
  return <>{q.data ? children(q.data) : null}</>;
}

const th = "whitespace-nowrap px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500";
const td = "whitespace-nowrap px-3 py-1.5";

/* ---------- Day book ---------- */

interface DayBookData {
  date: string;
  entries: { at: string; type: string; ref: string; refId: string; party: string; mode: string; amount: number; received: number; paid: number; cancelled: boolean }[];
  summary: { pharmacySales: number; hospitalInvoices: number; labBills?: number; purchases: number; received: number; cancelled: number; byMode: { mode: string; amount: number }[] };
}

function DayBook() {
  const [date, setDate] = useState(today);
  const q = useApiQuery<DayBookData>(`/api/reports/daybook${qs({ date })}`);
  return (
    <>
      <Toolbar
        title={`Day Book — ${formatDate(date)}`}
        onCsv={q.data && (() => downloadCsv(`daybook-${date}.csv`, ["Time", "Type", "Ref", "Party", "Mode", "Billed", "Received", "Paid out", "Cancelled"],
          q.data!.entries.map((e) => [formatDateTime(e.at), e.type, e.ref, e.party, e.mode, e.amount, e.received, e.paid, e.cancelled ? "Yes" : ""])))}
      >
        <Labeled label="Date"><input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value || today())} className={inputClass} /></Labeled>
      </Toolbar>
      <State q={q}>
        {(d) => (
          <>
            <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-5">
              <StatCard label="Pharmacy sales" value={formatMoney(d.summary.pharmacySales)} />
              <StatCard label="Hospital invoices" value={formatMoney(d.summary.hospitalInvoices)} />
              <StatCard label="Lab bills" value={formatMoney(d.summary.labBills ?? 0)} />
              <StatCard label="Collected" value={formatMoney(d.summary.received)} hint={d.summary.byMode.map((m) => `${m.mode} ${formatMoney(m.amount)}`).join(" · ") || "No collections"} />
              <StatCard label="Purchases" value={formatMoney(d.summary.purchases)} tone="slate" hint={d.summary.cancelled ? `${d.summary.cancelled} cancelled entr${d.summary.cancelled === 1 ? "y" : "ies"}` : undefined} />
            </div>
            <Card>
              {d.entries.length === 0 ? <EmptyState title="No transactions on this date" /> : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-100 text-sm">
                    <thead className="bg-slate-50"><tr>{["Time", "Type", "Ref", "Party", "Mode", "Billed", "Received", "Paid out"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
                    <tbody className="divide-y divide-slate-100 tabular-nums">
                      {d.entries.map((e) => (
                        <tr key={`${e.type}-${e.refId}`} className={cx(e.cancelled && "text-slate-400 line-through")}>
                          <td className={cx(td, "text-xs")}>{new Date(e.at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</td>
                          <td className={td}>{e.type}</td>
                          <td className={cx(td, "font-mono text-xs")}>
                            {e.type === "Pharmacy sale" ? <Link className="text-brand-700 hover:underline" href={`/pharmacy/sales/${e.refId}`}>{e.ref}</Link>
                              : e.type === "Purchase" ? <Link className="text-brand-700 hover:underline" href={`/pharmacy/purchases/${e.refId}`}>{e.ref}</Link>
                              : e.type === "Lab bill" ? <Link className="text-brand-700 hover:underline" href={`/laboratory/orders/${e.refId}`}>{e.ref}</Link> : e.ref}
                          </td>
                          <td className={td}>{e.party}</td>
                          <td className={td}>{e.mode}</td>
                          <td className={cx(td, "text-right")}>{e.amount ? money(e.amount) : ""}</td>
                          <td className={cx(td, "text-right")}>{e.received ? money(e.received) : ""}</td>
                          <td className={cx(td, "text-right")}>{e.paid ? money(e.paid) : ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </>
        )}
      </State>
    </>
  );
}

/* ---------- Sales register ---------- */

interface RegisterData {
  from: string;
  to: string;
  rows: { id: string; code: string; billDate: string; customerName: string; paymentMode: string; lines: number; taxable: number; gst: number; net: number; paid: number; status: string }[];
  totals: { bills: number; cancelled: number; taxable: number; gst: number; net: number; paid: number };
  gstSummary: { rate: number; qty: number; taxable: number; cgst: number; sgst: number; gst: number; amount: number }[];
}

function SalesRegister() {
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const q = useApiQuery<RegisterData>(`/api/reports/sales-register${qs({ from, to })}`);
  return (
    <>
      <Toolbar
        title={`Sales Register — ${formatDate(from)} to ${formatDate(to)}`}
        onCsv={q.data && (() => downloadCsv(`sales-register-${from}-to-${to}.csv`, ["Bill", "Date", "Customer", "Mode", "Lines", "Taxable", "GST", "Net", "Paid", "Status"],
          q.data!.rows.map((r) => [r.code, formatDate(r.billDate), r.customerName, r.paymentMode, r.lines, r.taxable, r.gst, r.net, r.paid, r.status])))}
      >
        <Labeled label="From"><input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value || monthStart())} className={inputClass} /></Labeled>
        <Labeled label="To"><input type="date" value={to} min={from} max={today()} onChange={(e) => setTo(e.target.value || today())} className={inputClass} /></Labeled>
      </Toolbar>
      <State q={q}>
        {(d) => (
          <>
            <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
              <StatCard label="Bills" value={d.totals.bills} hint={d.totals.cancelled ? `${d.totals.cancelled} cancelled (excluded)` : undefined} />
              <StatCard label="Net sales" value={formatMoney(d.totals.net)} />
              <StatCard label="GST collected" value={formatMoney(d.totals.gst)} tone="slate" />
              <StatCard label="Received" value={formatMoney(d.totals.paid)} tone={d.totals.paid < d.totals.net ? "amber" : "brand"} hint={d.totals.paid < d.totals.net ? `${formatMoney(d.totals.net - d.totals.paid)} pending` : undefined} />
            </div>
            <div className="grid gap-4 xl:grid-cols-3">
              <Card className="xl:col-span-2">
                {d.rows.length === 0 ? <EmptyState title="No bills in this period" /> : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-slate-100 text-sm">
                      <thead className="bg-slate-50"><tr>{["Bill", "Date", "Customer", "Mode", "Taxable", "GST", "Net", "Status"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
                      <tbody className="divide-y divide-slate-100 tabular-nums">
                        {d.rows.map((r) => (
                          <tr key={r.id} className={cx(r.status === "Cancelled" && "text-slate-400")}>
                            <td className={cx(td, "font-mono text-xs")}><Link className="text-brand-700 hover:underline" href={`/pharmacy/sales/${r.id}`}>{r.code}</Link></td>
                            <td className={td}>{formatDate(r.billDate)}</td>
                            <td className={td}>{r.customerName}</td>
                            <td className={td}>{r.paymentMode}</td>
                            <td className={cx(td, "text-right")}>{money(r.taxable)}</td>
                            <td className={cx(td, "text-right")}>{money(r.gst)}</td>
                            <td className={cx(td, "text-right font-medium")}>{money(r.net)}</td>
                            <td className={td}><Badge tone={statusTone(r.status)}>{r.status}</Badge></td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="border-t-2 border-slate-300 font-semibold tabular-nums">
                        <tr><td className={td} colSpan={4}>Total ({d.totals.bills} bills)</td><td className={cx(td, "text-right")}>{money(d.totals.taxable)}</td><td className={cx(td, "text-right")}>{money(d.totals.gst)}</td><td className={cx(td, "text-right")}>{money(d.totals.net)}</td><td /></tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </Card>
              <Card>
                <div className="border-b border-slate-100 px-4 py-3"><h3 className="text-sm font-semibold text-slate-900">GST summary (for GSTR-1)</h3></div>
                {d.gstSummary.length === 0 ? <p className="px-4 py-4 text-sm text-slate-500">No taxable sales.</p> : (
                  <table className="min-w-full text-sm tabular-nums">
                    <thead><tr>{["Rate", "Taxable", "CGST", "SGST"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {d.gstSummary.map((g) => (
                        <tr key={g.rate}><td className={td}>{g.rate}%</td><td className={cx(td, "text-right")}>{money(g.taxable)}</td><td className={cx(td, "text-right")}>{money(g.cgst)}</td><td className={cx(td, "text-right")}>{money(g.sgst)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>
            </div>
          </>
        )}
      </State>
    </>
  );
}

/* ---------- Stock ---------- */

interface StockData {
  rows: { id: string; name: string; sku: string | null; category: string; unit: string | null; quantity: number; reorderLevel: number | null; batches: number; expiredQty: number; nearestExpiry: string | null; costValue: number; mrpValue: number; status: string }[];
  totals: { items: number; lowOrOut: number; costValue: number; mrpValue: number };
}

function StockReport() {
  const [search, setSearch] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const debounced = useDebounced(search);
  const q = useApiQuery<StockData>(`/api/reports/stock${qs({ search: debounced, status: lowOnly ? "low" : "" })}`);
  return (
    <>
      <Toolbar
        title="Stock Report"
        onCsv={q.data && (() => downloadCsv(`stock-${today()}.csv`, ["Item", "Code", "Category", "Qty", "Reorder", "Batches", "Expired qty", "Nearest expiry", "Cost value", "MRP value", "Status"],
          q.data!.rows.map((r) => [r.name, r.sku, r.category, r.quantity, r.reorderLevel, r.batches, r.expiredQty, formatDate(r.nearestExpiry), r.costValue, r.mrpValue, r.status])))}
      >
        <Labeled label="Search"><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Item, code, manufacturer" className={inputClass} /></Labeled>
        <label className="flex items-center gap-2 pb-2 text-sm text-slate-700">
          <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} className="size-4 accent-brand-600" /> Low / out of stock only
        </label>
      </Toolbar>
      <State q={q}>
        {(d) => (
          <>
            <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
              <StatCard label="Items" value={d.totals.items} />
              <StatCard label="Low / out of stock" value={d.totals.lowOrOut} tone={d.totals.lowOrOut ? "red" : "slate"} />
              <StatCard label="Stock value (cost)" value={formatMoney(d.totals.costValue)} />
              <StatCard label="Stock value (MRP)" value={formatMoney(d.totals.mrpValue)} tone="slate" />
            </div>
            <Card>
              {d.rows.length === 0 ? <EmptyState title="No items" /> : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-100 text-sm">
                    <thead className="bg-slate-50"><tr>{["Item", "Category", "Qty", "Reorder", "Batches", "Nearest expiry", "Cost value", "MRP value", "Status"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
                    <tbody className="divide-y divide-slate-100 tabular-nums">
                      {d.rows.map((r) => (
                        <tr key={r.id}>
                          <td className={td}><span className="font-medium text-slate-900">{r.name}</span>{r.sku && <span className="ml-1.5 font-mono text-xs text-slate-500">{r.sku}</span>}</td>
                          <td className={td}>{r.category}</td>
                          <td className={cx(td, "text-right font-medium")}>{r.quantity}{r.unit ? ` ${r.unit}` : ""}</td>
                          <td className={cx(td, "text-right text-slate-500")}>{r.reorderLevel ?? "—"}</td>
                          <td className={cx(td, "text-right")}>{r.batches}</td>
                          <td className={td}>{formatDate(r.nearestExpiry)}{r.expiredQty > 0 && <span className="ml-1 text-xs text-red-600">({r.expiredQty} expired)</span>}</td>
                          <td className={cx(td, "text-right")}>{money(r.costValue)}</td>
                          <td className={cx(td, "text-right")}>{money(r.mrpValue)}</td>
                          <td className={td}><Badge tone={r.status === "In stock" ? "green" : r.status === "Low stock" ? "amber" : "red"}>{r.status}</Badge></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </>
        )}
      </State>
    </>
  );
}

/* ---------- Expiry ---------- */

interface ExpiryData {
  days: number;
  rows: { id: string; item: string; sku: string | null; batchNo: string; expiryDate: string; daysLeft: number; quantity: number; costValue: number; supplier: string | null; status: string }[];
  totals: { expiredBatches: number; expiringBatches: number; valueAtRisk: number };
}

function ExpiryReport() {
  const [days, setDays] = useState("90");
  const q = useApiQuery<ExpiryData>(`/api/reports/expiry${qs({ days })}`);
  return (
    <>
      <Toolbar
        title={`Expiry Report — next ${days} days`}
        onCsv={q.data && (() => downloadCsv(`expiry-${today()}.csv`, ["Item", "Batch", "Expiry", "Days left", "Qty", "Cost value", "Supplier", "Status"],
          q.data!.rows.map((r) => [r.item, r.batchNo, formatDate(r.expiryDate), r.daysLeft, r.quantity, r.costValue, r.supplier, r.status])))}
      >
        <Labeled label="Expiring within">
          <select value={days} onChange={(e) => setDays(e.target.value)} className={inputClass}>
            {["30", "60", "90", "180", "365"].map((d) => <option key={d} value={d}>{d} days</option>)}
          </select>
        </Labeled>
      </Toolbar>
      <State q={q}>
        {(d) => (
          <>
            <div className="mb-4 grid grid-cols-3 gap-4">
              <StatCard label="Expired batches (in stock)" value={d.totals.expiredBatches} tone={d.totals.expiredBatches ? "red" : "slate"} />
              <StatCard label={`Expiring in ${d.days} days`} value={d.totals.expiringBatches} tone={d.totals.expiringBatches ? "amber" : "slate"} />
              <StatCard label="Value at risk (cost)" value={formatMoney(d.totals.valueAtRisk)} />
            </div>
            <Card>
              {d.rows.length === 0 ? <EmptyState title="Nothing expiring in this window" /> : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-100 text-sm">
                    <thead className="bg-slate-50"><tr>{["Item", "Batch", "Expiry", "Days left", "Qty", "Cost value", "Supplier", "Status"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
                    <tbody className="divide-y divide-slate-100 tabular-nums">
                      {d.rows.map((r) => (
                        <tr key={r.id} className={cx(r.daysLeft < 0 && "bg-red-50/60")}>
                          <td className={cx(td, "font-medium text-slate-900")}>{r.item}</td>
                          <td className={cx(td, "font-mono text-xs")}>{r.batchNo}</td>
                          <td className={td}>{formatDate(r.expiryDate)}</td>
                          <td className={cx(td, "text-right", r.daysLeft < 0 ? "font-semibold text-red-700" : r.daysLeft <= 30 ? "text-amber-700" : "")}>{r.daysLeft}</td>
                          <td className={cx(td, "text-right")}>{r.quantity}</td>
                          <td className={cx(td, "text-right")}>{money(r.costValue)}</td>
                          <td className={td}>{r.supplier ?? "—"}</td>
                          <td className={td}><Badge tone={r.daysLeft < 0 ? "red" : "amber"}>{r.status}</Badge></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </>
        )}
      </State>
    </>
  );
}

/* ---------- Outstanding ---------- */

interface OutstandingData {
  rows: { source: string; id: string; ref: string; date: string; party: string; phone: string | null; billed: number; paid: number; balance: number; ageDays: number }[];
  totals: { count: number; balance: number; aging: { label: string; amount: number }[] };
}

function Outstanding() {
  const q = useApiQuery<OutstandingData>("/api/reports/outstanding");
  return (
    <>
      <Toolbar
        title="Outstanding Receivables"
        onCsv={q.data && (() => downloadCsv(`outstanding-${today()}.csv`, ["Source", "Ref", "Date", "Party", "Phone", "Billed", "Paid", "Balance", "Age (days)"],
          q.data!.rows.map((r) => [r.source, r.ref, formatDate(r.date), r.party, r.phone, r.billed, r.paid, r.balance, r.ageDays])))}
      />
      <State q={q}>
        {(d) => (
          <>
            <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-5">
              <StatCard label="Total outstanding" value={formatMoney(d.totals.balance)} hint={`${d.totals.count} bill(s)`} tone={d.totals.balance ? "amber" : "slate"} />
              {d.totals.aging.map((a) => <StatCard key={a.label} label={a.label} value={formatMoney(a.amount)} tone="slate" />)}
            </div>
            <Card>
              {d.rows.length === 0 ? <EmptyState title="No outstanding bills" description="All pharmacy bills and hospital invoices are fully paid." /> : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-100 text-sm">
                    <thead className="bg-slate-50"><tr>{["Source", "Ref", "Date", "Party", "Billed", "Paid", "Balance", "Age"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
                    <tbody className="divide-y divide-slate-100 tabular-nums">
                      {d.rows.map((r) => (
                        <tr key={`${r.source}-${r.id}`}>
                          <td className={td}>{r.source}</td>
                          <td className={cx(td, "font-mono text-xs")}>{r.source === "Pharmacy" ? <Link className="text-brand-700 hover:underline" href={`/pharmacy/sales/${r.id}`}>{r.ref}</Link>
                            : r.source === "Laboratory" ? <Link className="text-brand-700 hover:underline" href={`/laboratory/orders/${r.id}`}>{r.ref}</Link> : r.ref}</td>
                          <td className={td}>{formatDate(r.date)}</td>
                          <td className={td}>{r.party}{r.phone && <span className="ml-1.5 text-xs text-slate-500">{r.phone}</span>}</td>
                          <td className={cx(td, "text-right")}>{money(r.billed)}</td>
                          <td className={cx(td, "text-right")}>{money(r.paid)}</td>
                          <td className={cx(td, "text-right font-semibold text-amber-800")}>{money(r.balance)}</td>
                          <td className={cx(td, "text-right", r.ageDays > 60 && "text-red-700")}>{r.ageDays}d</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </>
        )}
      </State>
    </>
  );
}
