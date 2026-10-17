"use client";

import { BedDouble, CircleDollarSign, FileSpreadsheet, Lock, LockOpen, Plus, Printer, Receipt, Search, Wallet } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { api, qs } from "@/lib/client";
import { downloadCsv } from "@/lib/csv";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { BILL_PAYMENT_MODES, BILL_TYPES } from "@/lib/modules";
import { useApiQuery } from "@/lib/useApi";
import { FormModal, numOrUndefined } from "../FormModal";
import { TableCard } from "../TableCard";
import { Alert, Badge, Button, Card, CardHeader, EmptyState, ErrorState, Kbd, Pagination, Spinner, StatCard, cx, inputClass, useDebounced, useHotkeys, useToast } from "../ui";
import { billTone, payTone, type BillRow, type Shift, type ShiftTotals } from "./types";

/** Bespoke billing tabs: bills, IPD board, dues, cash counter, receipts, reconciliation, closing and reports. */
export function BillingSection({ section }: { section: string }) {
  switch (section) {
    case "ipd":
      return <IpdBoard />;
    case "payers":
      return <Dues party="payer" />;
    case "counter":
      return <CashCounter />;
    case "receipts":
      return <ReceiptRegister />;
    case "dues":
      return <Dues party="patient" />;
    case "refunds":
      return <Refunds />;
    case "reconciliation":
      return <Reconciliation />;
    case "closing":
      return <DayClosing />;
    case "reports":
      return <BillingReports />;
    case "doctor_fees":
      return <DoctorFees />;
    default:
      return <BillRegister />;
  }
}

const th = "whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500";
const td = "whitespace-nowrap px-4 py-2.5";
const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => `${today().slice(0, 8)}01`;
const billLink = (id: string, code: string) => <Link href={`/billing/bills/${id}`} className="font-mono text-xs text-brand-700 hover:underline">{code}</Link>;

function Loading<T>({ q, children, label }: { q: { data?: T; error: string | null; loading: boolean; reload: () => void }; children: (d: T) => React.ReactNode; label?: string }) {
  if (q.loading) return <Spinner label={label} />;
  if (q.error) return <Card><ErrorState message={q.error} onRetry={q.reload} /></Card>;
  return q.data !== undefined ? <>{children(q.data)}</> : null;
}

/* ======================= Bills ======================= */

function BillRegister() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [billType, setBillType] = useState("");
  const [paymentStatus, setPaymentStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const debounced = useDebounced(search);
  const searchRef = useRef<HTMLInputElement>(null);
  const q = useApiQuery<BillRow[]>(`/api/billing/bills${qs({ search: debounced, status, billType, paymentStatus, from, to, page })}`);
  const rows = q.data ?? [];
  useHotkeys({ F2: () => router.push("/billing/new"), F3: () => searchRef.current?.focus() });
  const reset = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(1);
  };
  return (
    <Card>
      <div className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-2 lg:grid-cols-7">
        <div className="relative sm:col-span-2">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <input ref={searchRef} value={search} onChange={(e) => reset(setSearch)(e.target.value)} placeholder="Bill / receipt no., patient, mobile, IPD no., payer…  (F3)" className={cx(inputClass, "pl-9")} aria-label="Search bills" />
        </div>
        <select value={status} onChange={(e) => reset(setStatus)(e.target.value)} className={inputClass} aria-label="Status">
          <option value="">All statuses</option>
          {["Provisional", "Final", "Closed", "Cancelled"].map((s) => <option key={s}>{s}</option>)}
        </select>
        <select value={billType} onChange={(e) => reset(setBillType)(e.target.value)} className={inputClass} aria-label="Bill type">
          <option value="">All types</option>
          {BILL_TYPES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <select value={paymentStatus} onChange={(e) => reset(setPaymentStatus)(e.target.value)} className={inputClass} aria-label="Payment">
          <option value="">Any payment</option>
          {["Unpaid", "Partially Paid", "Paid", "Advance", "Refund Due", "Cancelled"].map((s) => <option key={s}>{s}</option>)}
        </select>
        <input type="date" value={from} max={to || undefined} onChange={(e) => reset(setFrom)(e.target.value)} className={inputClass} aria-label="From date" />
        <input type="date" value={to} min={from || undefined} onChange={(e) => reset(setTo)(e.target.value)} className={inputClass} aria-label="To date" />
      </div>
      <div className="flex items-center justify-end border-b border-slate-100 px-4 py-2.5">
        <Link href="/billing/new"><Button><Plus className="size-4" /> New bill <Kbd>F2</Kbd></Button></Link>
      </div>
      {q.loading ? (
        <Spinner />
      ) : q.error ? (
        <ErrorState message={q.error} onRetry={q.reload} />
      ) : rows.length === 0 ? (
        <EmptyState title={debounced || status || billType || paymentStatus || from || to ? "No matching bills" : "No bills yet"} description="Open a bill with F2." action={<Link href="/billing/new"><Button><Plus className="size-4" /> New bill</Button></Link>} />
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead className="bg-slate-50/60"><tr>{["Bill", "Date", "Patient", "Payer", "Net", "Paid", "Due", "Status", ""].map((h, i) => <th key={i} className={th}>{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((b) => (
                <tr key={b.id} onClick={() => router.push(`/billing/bills/${b.id}`)} className="cursor-pointer hover:bg-brand-50/40">
                  <td className={td}><span className="font-mono text-xs text-brand-700">{b.code}</span><span className="block text-xs text-slate-500">{b.billType}{b.admissionCode ? ` · ${b.admissionCode}` : ""}</span></td>
                  <td className={cx(td, "text-slate-600")}>{formatDate(b.billDate)}</td>
                  <td className={td}><span className="font-medium text-slate-900">{b.patientName}</span>{b.patientCode && <span className="ml-1 text-xs text-slate-500">{b.patientCode}</span>}<span className="block text-xs text-slate-500">{b.doctorName ?? b.patientMobile ?? ""}</span></td>
                  <td className={cx(td, "text-slate-600")}>{b.payerType === "Self" ? "Self" : b.payerName}</td>
                  <td className={cx(td, "tabular-nums")}>{formatMoney(b.netAmount)}</td>
                  <td className={cx(td, "tabular-nums")}>{formatMoney(b.patientPaid)}</td>
                  <td className={cx(td, "tabular-nums", (b.patientDue > 0 || b.payerDue > 0) && "text-amber-700")}>{formatMoney(b.patientDue)}{b.payerDue > 0 && <span className="block text-xs text-slate-500">payer {formatMoney(b.payerDue)}</span>}</td>
                  <td className={td}><Badge tone={billTone(b.status)}>{b.status}</Badge> <Badge tone={payTone(b.paymentStatus)}>{b.paymentStatus}</Badge></td>
                  <td className={cx(td, "text-right text-xs text-brand-700")}>Open →</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!q.loading && !q.error && <Pagination pagination={q.pagination} onPage={setPage} />}
    </Card>
  );
}

/* ======================= IPD board ======================= */

interface IpdBill { id: string; code: string; status: string; netAmount: number; patientPaid: number; patientDue: number; payerType: string; payerName: string | null; paymentStatus: string; advanceBalance: number }
interface IpdData {
  admitted: { admissionId: string; admissionCode: string; admissionDate: string; days: number; ward: string; bed: string; doctor: string | null; patientId: string | null; patientName: string; patientCode: string | null; bill: IpdBill | null; deptDue: number }[];
  pending: (IpdBill & { patientId: string; patientName: string; patientCode: string | null; admissionCode: string | null; admissionDate: string | null; deptDue: number })[];
}

function IpdBoard() {
  const q = useApiQuery<IpdData>("/api/billing/reports/ipd");
  return (
    <Loading q={q} label="Loading IPD board…">
      {(d) => (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label="Admitted" value={d.admitted.length} hint={`${d.admitted.filter((a) => !a.bill).length} without a bill`} icon={<BedDouble className="size-5" />} />
            <StatCard label="Running bills" value={formatMoney(d.admitted.reduce((s, a) => s + (a.bill?.netAmount ?? 0), 0))} hint={`Advance held ${formatMoney(d.admitted.reduce((s, a) => s + (a.bill?.advanceBalance ?? 0), 0))}`} />
            <StatCard label="Discharged, bill open" value={d.pending.length} tone={d.pending.length ? "amber" : "slate"} hint="Finalise these bills" />
          </div>
          <Card>
            <CardHeader title="Admitted patients" description="Running bill, advance and departmental dues per admission" />
            {d.admitted.length === 0 ? <EmptyState title="No admitted patients" /> : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-100 text-sm">
                  <thead className="bg-slate-50/60"><tr>{["Admission", "Patient", "Ward / bed", "Stay", "Bill", "Net", "Paid", "Lab/pharmacy due", ""].map((h, i) => <th key={i} className={th}>{h}</th>)}</tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {d.admitted.map((a) => (
                      <tr key={a.admissionId}>
                        <td className={td}><span className="font-mono text-xs">{a.admissionCode}</span><span className="block text-xs text-slate-500">{formatDate(a.admissionDate)}</span></td>
                        <td className={td}><span className="font-medium text-slate-900">{a.patientName}</span>{a.patientCode && <span className="ml-1 text-xs text-slate-500">{a.patientCode}</span>}<span className="block text-xs text-slate-500">{a.doctor ?? ""}</span></td>
                        <td className={cx(td, "text-slate-600")}>{a.ward} / {a.bed}</td>
                        <td className={cx(td, "tabular-nums")}>{a.days} d</td>
                        <td className={td}>{a.bill ? <>{billLink(a.bill.id, a.bill.code)} <Badge tone={billTone(a.bill.status)}>{a.bill.status}</Badge>{a.bill.payerType !== "Self" && <span className="block text-xs text-slate-500">{a.bill.payerName}</span>}</> : <span className="text-xs text-amber-700">No bill</span>}</td>
                        <td className={cx(td, "tabular-nums")}>{a.bill ? formatMoney(a.bill.netAmount) : "—"}</td>
                        <td className={cx(td, "tabular-nums")}>{a.bill ? formatMoney(a.bill.patientPaid) : "—"}{a.bill && a.bill.advanceBalance > 0 && <span className="block text-xs text-emerald-700">advance {formatMoney(a.bill.advanceBalance)}</span>}</td>
                        <td className={cx(td, "tabular-nums", a.deptDue > 0 && "text-amber-700")}>{a.deptDue > 0 ? formatMoney(a.deptDue) : "—"}</td>
                        <td className={cx(td, "text-right")}>{a.bill ? <Link href={`/billing/bills/${a.bill.id}`} className="text-xs text-brand-700 hover:underline">Open →</Link> : a.patientId ? <Link href={`/billing/new?patient=${a.patientId}`} className="text-xs text-brand-700 hover:underline">Open bill →</Link> : null}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          <TableCard title="Discharged with a provisional bill" description="The admission has ended but the IPD bill is still open" headers={["Bill", "Patient", "Admission", "Net", "Paid", "Due"]}
            rows={d.pending.map((b) => [billLink(b.id, b.code), `${b.patientName}${b.patientCode ? ` (${b.patientCode})` : ""}`, b.admissionCode ?? "—", formatMoney(b.netAmount), formatMoney(b.patientPaid), formatMoney(b.patientDue)])} empty="None — every discharged patient's bill is final." />
        </div>
      )}
    </Loading>
  );
}

/* ======================= Dues (patient / payer) ======================= */

interface DueRow extends BillRow { ageDays: number; balance: number; payerPaid: number; payerWriteOff: number; tpaName: string | null; authNo: string | null; dueDate: string | null; overdue: boolean }
interface DuesData { party: string; rows: DueRow[]; totals: { count: number; balance: number; overdue: number; aging: { label: string; amount: number }[] } }

function Dues({ party }: { party: "patient" | "payer" }) {
  const [search, setSearch] = useState("");
  const [payerType, setPayerType] = useState("");
  const [running, setRunning] = useState(false);
  const debounced = useDebounced(search);
  const q = useApiQuery<DuesData>(`/api/billing/reports/dues${qs({ party, search: debounced, payerType: party === "payer" ? payerType : undefined, running: party === "patient" && running ? 1 : undefined })}`);
  const d = q.data;
  function exportCsv() {
    if (!d) return;
    downloadCsv(`${party}-dues_${today()}.csv`, ["Bill", "Date", "Patient", "Mobile", party === "payer" ? "Payer" : "Type", "Net", "Due", "Age (days)", "Overdue"],
      d.rows.map((r) => [r.code, r.billDate.slice(0, 10), r.patientName, r.patientMobile, party === "payer" ? r.payerName : r.billType, r.netAmount, r.balance, r.ageDays, r.overdue ? "Yes" : ""]));
  }
  return (
    <div className="space-y-4">
      {d && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label={party === "payer" ? "Due from payers" : "Due from patients"} value={formatMoney(d.totals.balance)} hint={`${d.totals.count} bill(s)`} icon={<CircleDollarSign className="size-5" />} />
          <StatCard label="Overdue" value={formatMoney(d.totals.overdue)} hint={party === "payer" ? "Past the credit period" : "Older than 30 days"} tone={d.totals.overdue ? "red" : "slate"} />
          <StatCard label="0–30 days" value={formatMoney(d.totals.aging[0]?.amount ?? 0)} tone="slate" />
          <StatCard label="Over 30 days" value={formatMoney(d.totals.aging.slice(1).reduce((s, a) => s + a.amount, 0))} hint={d.totals.aging.slice(1).map((a) => `${a.label} ${formatMoney(a.amount)}`).join(" · ")} tone="slate" />
        </div>
      )}
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
          <div className="relative min-w-[16rem] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Bill, patient, mobile, payer, policy, claim…" className={cx(inputClass, "pl-9")} aria-label="Search dues" />
          </div>
          {party === "payer" ? (
            <select value={payerType} onChange={(e) => setPayerType(e.target.value)} className={cx(inputClass, "w-44")} aria-label="Payer type">
              <option value="">All payers</option><option>Corporate</option><option>Insurance</option>
            </select>
          ) : (
            <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={running} onChange={(e) => setRunning(e.target.checked)} className="size-4 rounded border-slate-300 text-brand-600" /> Include running (provisional) bills</label>
          )}
          <Button variant="secondary" onClick={exportCsv} disabled={!d?.rows.length}><FileSpreadsheet className="size-4" /> CSV</Button>
        </div>
        {q.loading ? <Spinner /> : q.error ? <ErrorState message={q.error} onRetry={q.reload} /> : !d?.rows.length ? <EmptyState title="Nothing outstanding" /> : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead className="bg-slate-50/60"><tr>{["Bill", "Patient", party === "payer" ? "Payer" : "Type", "Net", party === "payer" ? "Payer paid" : "Paid", "Due", party === "payer" ? "Due date" : "Age"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-slate-100">
                {d.rows.map((r) => (
                  <tr key={r.id} className={cx(r.overdue && "bg-red-50/40")}>
                    <td className={td}>{billLink(r.id, r.code)}<span className="block text-xs text-slate-500">{formatDate(r.finalizedAt ?? r.billDate)}</span></td>
                    <td className={td}><span className="font-medium text-slate-900">{r.patientName}</span><span className="block text-xs text-slate-500">{r.patientMobile ?? r.patientCode ?? ""}</span></td>
                    <td className={cx(td, "text-slate-600")}>{party === "payer" ? <>{r.payerName}<span className="block text-xs text-slate-500">{[r.policyNo, r.tpaName, r.claimCode].filter(Boolean).join(" · ")}</span></> : <>{r.billType} <Badge tone={billTone(r.status)}>{r.status}</Badge></>}</td>
                    <td className={cx(td, "tabular-nums")}>{formatMoney(r.netAmount)}</td>
                    <td className={cx(td, "tabular-nums")}>{formatMoney(party === "payer" ? r.payerPaid : r.patientPaid)}{party === "payer" && r.payerWriteOff > 0 && <span className="block text-xs text-slate-500">w/o {formatMoney(r.payerWriteOff)}</span>}</td>
                    <td className={cx(td, "font-medium tabular-nums text-amber-700")}>{formatMoney(r.balance)}</td>
                    <td className={cx(td, r.overdue ? "text-red-600" : "text-slate-600")}>{party === "payer" ? formatDate(r.dueDate) : `${r.ageDays} d`}{r.overdue && <span className="block text-xs">Overdue</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

/* ======================= Refunds ======================= */

function Refunds() {
  const q = useApiQuery<{ rows: (BillRow & { cancelReason: string | null })[]; total: number }>("/api/billing/reports/refunds");
  return (
    <Loading q={q}>
      {(d) => (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <StatCard label="Refunds due" value={formatMoney(d.total)} hint={`${d.rows.length} bill(s)`} tone={d.total ? "amber" : "slate"} />
          </div>
          <TableCard title="Patients to refund" description="Open each bill and record the refund at the counter" headers={["Bill", "Patient", "Status", "Net", "Paid", "Refund due"]}
            rows={d.rows.map((r) => [billLink(r.id, r.code), `${r.patientName}${r.patientMobile ? ` · ${r.patientMobile}` : ""}`, <span key="s">{r.status}{r.cancelReason ? ` — ${r.cancelReason}` : ""}</span>, formatMoney(r.netAmount), formatMoney(r.patientPaid), formatMoney(r.refundDue)])} empty="No refunds are due." />
        </div>
      )}
    </Loading>
  );
}

/* ======================= Cash counter & shifts ======================= */

type CurrentShift = (Shift & { totals: ShiftTotals; expectedCash: number }) | null;

function CashCounter() {
  const toast = useToast();
  const current = useApiQuery<CurrentShift>("/api/billing/shifts/current");
  const [page, setPage] = useState(1);
  const list = useApiQuery<Shift[]>(`/api/billing/shifts${qs({ page })}`);
  const [dialog, setDialog] = useState<"open" | "close" | null>(null);
  const s = current.data;
  const refresh = () => {
    current.reload();
    list.reload();
  };

  return (
    <div className="space-y-4">
      {current.loading ? <Spinner /> : current.error ? <Card><ErrorState message={current.error} onRetry={current.reload} /></Card> : !s ? (
        <Card>
          <EmptyState title="Your shift is not open" description="Open a cash counter shift with the cash in the drawer to start taking receipts." action={<Button onClick={() => setDialog("open")}><LockOpen className="size-4" /> Open shift</Button>} />
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Shift" value={s.code} hint={`${s.counter} · opened ${formatDateTime(s.openedAt)}`} icon={<Wallet className="size-5" />} />
            <StatCard label="Collected" value={formatMoney(s.totals.collected)} hint={`${s.totals.receipts} receipt(s)`} />
            <StatCard label="Refunded" value={formatMoney(s.totals.refunded)} hint={`${s.totals.refunds} refund(s)`} tone={s.totals.refunded ? "amber" : "slate"} />
            <StatCard label="Cash in drawer" value={formatMoney(s.expectedCash)} hint={`Opening ${formatMoney(s.openingCash)} + net cash`} />
          </div>
          <TableCard title="By payment mode" headers={["Mode", "Collected", "Refunded", "Net"]} rows={s.totals.byMode.filter((m) => m.collected || m.refunded).map((m) => [m.mode, formatMoney(m.collected), formatMoney(m.refunded), formatMoney(m.net)])} empty="No receipts in this shift yet."
            actions={<div className="flex gap-2"><Link href={`/m/billing?tab=receipts`}><Button variant="secondary"><Receipt className="size-4" /> Receipts</Button></Link><Button variant="danger" onClick={() => setDialog("close")}><Lock className="size-4" /> Close shift</Button></div>} />
        </>
      )}
      <Card>
        <CardHeader title="Shift history" />
        {list.loading ? <Spinner /> : list.error ? <ErrorState message={list.error} onRetry={list.reload} /> : !list.data?.length ? <p className="px-5 py-4 text-sm text-slate-500">No shifts yet.</p> : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead className="bg-slate-50/60"><tr>{["Shift", "Cashier", "Opened", "Closed", "Collected", "Refunded", "Cash expected", "Counted", "Difference"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-slate-100">
                {list.data.map((x) => (
                  <tr key={x.id}>
                    <td className={td}><span className="font-mono text-xs">{x.code}</span> <Badge tone={x.status === "Open" ? "green" : "slate"}>{x.status}</Badge><span className="block text-xs text-slate-500">{x.counter}</span></td>
                    <td className={td}>{x.userName}</td>
                    <td className={cx(td, "text-slate-600")}>{formatDateTime(x.openedAt)}</td>
                    <td className={cx(td, "text-slate-600")}>{formatDateTime(x.closedAt)}{x.handoverTo && <span className="block text-xs text-slate-500">to {x.handoverTo}</span>}</td>
                    <td className={cx(td, "tabular-nums")}>{formatMoney(x.totals?.collected ?? 0)}</td>
                    <td className={cx(td, "tabular-nums")}>{formatMoney(x.totals?.refunded ?? 0)}</td>
                    <td className={cx(td, "tabular-nums")}>{x.expectedCash != null ? formatMoney(x.expectedCash) : "—"}</td>
                    <td className={cx(td, "tabular-nums")}>{x.countedCash != null ? formatMoney(x.countedCash) : "—"}</td>
                    <td className={cx(td, "tabular-nums", (x.difference ?? 0) < 0 ? "text-red-600" : (x.difference ?? 0) > 0 ? "text-amber-700" : "")}>{x.difference != null ? formatMoney(x.difference) : "—"}{x.notes && <span className="block max-w-[14rem] truncate text-xs text-slate-500" title={x.notes}>{x.notes}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!list.loading && !list.error && <Pagination pagination={list.pagination} onPage={setPage} />}
      </Card>
      {dialog === "open" && (
        <FormModal title="Open cash counter shift" confirmLabel="Open shift" onClose={() => setDialog(null)}
          fields={[{ name: "counter", label: "Counter", defaultValue: "Main Cash Counter", maxLength: 40 }, { name: "openingCash", label: "Opening cash in drawer (₹)", type: "number", min: 0, required: true, defaultValue: "0" }]}
          onSubmit={async (v) => {
            await api("/api/billing/shifts", { method: "POST", body: { counter: v.counter, openingCash: numOrUndefined(v.openingCash) ?? 0 } });
            toast("Shift opened");
            setDialog(null);
            refresh();
          }} />
      )}
      {dialog === "close" && s && (
        <FormModal title={`Close shift ${s.code}`} description={`Cash expected in the drawer: ${formatMoney(s.expectedCash)}`} confirmLabel="Close shift" danger onClose={() => setDialog(null)}
          fields={[
            { name: "countedCash", label: "Cash counted (₹)", type: "number", min: 0, required: true },
            { name: "handoverTo", label: "Cash handed over to", maxLength: 80 },
            { name: "notes", label: "Notes", type: "textarea", maxLength: 300, hint: "Required when the cash is over or short" },
          ]}
          onSubmit={async (v) => {
            await api(`/api/billing/shifts/${s.id}/close`, { method: "POST", body: { countedCash: numOrUndefined(v.countedCash), handoverTo: v.handoverTo, notes: v.notes } });
            toast("Shift closed");
            setDialog(null);
            refresh();
          }}>
          {(v) => {
            const diff = v.countedCash === "" ? null : Math.round((Number(v.countedCash) - s.expectedCash) * 100) / 100;
            return diff === null || diff === 0 ? null : <Alert tone="amber">Cash is {diff > 0 ? "over" : "short"} by {formatMoney(Math.abs(diff))}.</Alert>;
          }}
        </FormModal>
      )}
    </div>
  );
}

/* ======================= Receipt register ======================= */

interface ReceiptRow { billId: string; billCode: string; patientName: string; patientCode: string | null; billType: string; payerName: string | null; id: string; code: string; kind: string; amount: number; writeOff: number; toPatient: number; reason: string | null; at: string; byName: string | null; shiftCode: string | null; splits: { id: string; mode: string; amount: number; reference: string | null; recon: string }[] }

function ReceiptRegister() {
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState("");
  const [mode, setMode] = useState("");
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [page, setPage] = useState(1);
  const debounced = useDebounced(search);
  const q = useApiQuery<{ items: ReceiptRow[]; totals: Record<string, number> }>(`/api/billing/receipts${qs({ search: debounced, kind, mode, from, to, page })}`);
  const d = q.data;
  const reset = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(1);
  };
  return (
    <div className="space-y-4">
      {d && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {(["Advance", "Payment", "Settlement", "Refund"] as const).map((k) => <StatCard key={k} label={k === "Settlement" ? "Payer settlements" : `${k}s`} value={formatMoney(d.totals[k] ?? 0)} tone={k === "Refund" ? "amber" : "brand"} />)}
        </div>
      )}
      <Card>
        <div className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-2 lg:grid-cols-6">
          <div className="relative sm:col-span-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <input value={search} onChange={(e) => reset(setSearch)(e.target.value)} placeholder="Receipt / bill no., patient…" className={cx(inputClass, "pl-9")} aria-label="Search receipts" />
          </div>
          <select value={kind} onChange={(e) => reset(setKind)(e.target.value)} className={inputClass} aria-label="Type"><option value="">All types</option>{["Advance", "Payment", "Refund", "Settlement"].map((k) => <option key={k}>{k}</option>)}</select>
          <select value={mode} onChange={(e) => reset(setMode)(e.target.value)} className={inputClass} aria-label="Mode"><option value="">All modes</option>{BILL_PAYMENT_MODES.map((m) => <option key={m}>{m}</option>)}</select>
          <input type="date" value={from} max={to || undefined} onChange={(e) => reset(setFrom)(e.target.value)} className={inputClass} aria-label="From date" />
          <input type="date" value={to} min={from || undefined} onChange={(e) => reset(setTo)(e.target.value)} className={inputClass} aria-label="To date" />
        </div>
        {q.loading ? <Spinner /> : q.error ? <ErrorState message={q.error} onRetry={q.reload} /> : !d?.items.length ? <EmptyState title="No receipts" description="Change the dates or filters." /> : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead className="bg-slate-50/60"><tr>{["Receipt", "When", "Bill", "Patient", "Modes", "Amount"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-slate-100">
                {d.items.map((r) => (
                  <tr key={r.id}>
                    <td className={td}><span className="font-mono text-xs">{r.code}</span> <Badge tone={r.kind === "Refund" ? "red" : r.kind === "Settlement" ? "blue" : r.kind === "Advance" ? "violet" : "green"}>{r.kind}</Badge></td>
                    <td className={cx(td, "text-slate-600")}>{formatDateTime(r.at)}<span className="block text-xs text-slate-500">{r.byName}{r.shiftCode ? ` · ${r.shiftCode}` : ""}</span></td>
                    <td className={td}>{billLink(r.billId, r.billCode)}<span className="block text-xs text-slate-500">{r.billType}</span></td>
                    <td className={td}>{r.patientName}{r.kind === "Settlement" && r.payerName && <span className="block text-xs text-slate-500">{r.payerName}</span>}</td>
                    <td className={cx(td, "text-xs text-slate-600")}>{r.splits.map((s) => `${s.mode}${s.reference ? ` (${s.reference})` : ""}${s.recon === "Bounced" ? " — bounced" : ""}`).join(" + ") || "—"}</td>
                    <td className={cx(td, "font-medium tabular-nums", r.kind === "Refund" && "text-red-600")}>{r.kind === "Refund" ? "−" : ""}{formatMoney(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!q.loading && !q.error && <Pagination pagination={q.pagination} onPage={setPage} />}
      </Card>
    </div>
  );
}

/* ======================= Reconciliation ======================= */

interface ReconRow { billId: string; billCode: string; patientName: string; receiptId: string; receiptCode: string; kind: string; at: string; byName: string | null; splitId: string; mode: string; amount: number; reference: string | null; recon: string; reconAt: string | null; reconByName: string | null; reconNote: string | null }

function Reconciliation() {
  const toast = useToast();
  const [status, setStatus] = useState("Pending");
  const [mode, setMode] = useState("");
  const [page, setPage] = useState(1);
  const q = useApiQuery<{ items: ReconRow[]; total: number }>(`/api/billing/recon${qs({ status, mode, page })}`);
  const [busy, setBusy] = useState<string | null>(null);
  const [bouncing, setBouncing] = useState<ReconRow | null>(null);
  const mark = async (r: ReconRow, next: string, note?: string) => {
    setBusy(r.splitId);
    try {
      await api("/api/billing/recon", { method: "POST", body: { bill: r.billId, receipt: r.receiptId, split: r.splitId, status: next, note } });
      toast(next === "Reconciled" ? `${r.receiptCode} reconciled` : next === "Bounced" ? `${r.receiptCode} marked bounced — the amount is due again` : "Reset to pending");
      q.reload();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  };
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className={cx(inputClass, "w-44")} aria-label="Status">{["Pending", "Reconciled", "Bounced"].map((s) => <option key={s}>{s}</option>)}</select>
        <select value={mode} onChange={(e) => { setMode(e.target.value); setPage(1); }} className={cx(inputClass, "w-44")} aria-label="Mode"><option value="">All non-cash modes</option>{BILL_PAYMENT_MODES.filter((m) => m !== "Cash").map((m) => <option key={m}>{m}</option>)}</select>
        {q.data && <p className="ml-auto text-sm text-slate-600">{status}: <strong className="tabular-nums">{formatMoney(q.data.total)}</strong></p>}
      </div>
      {q.loading ? <Spinner /> : q.error ? <ErrorState message={q.error} onRetry={q.reload} /> : !q.data?.items.length ? <EmptyState title={status === "Pending" ? "Everything is reconciled" : `No ${status.toLowerCase()} payments`} description="Card, UPI, bank transfer and cheque receipts are matched against the bank / settlement statement here." /> : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead className="bg-slate-50/60"><tr>{["Receipt", "Received", "Bill / patient", "Mode", "Reference", "Amount", ""].map((h, i) => <th key={i} className={th}>{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {q.data.items.map((r) => (
                <tr key={r.splitId}>
                  <td className={td}><span className="font-mono text-xs">{r.receiptCode}</span><span className="block text-xs text-slate-500">{r.kind}</span></td>
                  <td className={cx(td, "text-slate-600")}>{formatDateTime(r.at)}<span className="block text-xs text-slate-500">{r.byName}</span></td>
                  <td className={td}>{billLink(r.billId, r.billCode)}<span className="block text-xs text-slate-500">{r.patientName}</span></td>
                  <td className={td}>{r.mode}</td>
                  <td className={cx(td, "font-mono text-xs")}>{r.reference ?? "—"}{r.reconNote && <span className="block font-sans text-slate-500">{r.reconNote}</span>}</td>
                  <td className={cx(td, "tabular-nums")}>{formatMoney(r.amount)}</td>
                  <td className={cx(td, "text-right")}>
                    {r.recon === "Pending" ? (
                      <div className="flex justify-end gap-2">
                        <Button variant="secondary" loading={busy === r.splitId} onClick={() => mark(r, "Reconciled")}>Reconciled</Button>
                        <Button variant="ghost" className="text-red-600" disabled={busy === r.splitId} onClick={() => setBouncing(r)}>Bounced…</Button>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-500">{r.reconByName} · {formatDateTime(r.reconAt)} <button className="ml-1 text-brand-700 hover:underline" onClick={() => mark(r, "Pending")}>Undo</button></span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!q.loading && !q.error && <Pagination pagination={q.pagination} onPage={setPage} />}
      {bouncing && (
        <FormModal title={`Mark ${bouncing.mode} ${formatMoney(bouncing.amount)} as bounced`} description={`${bouncing.receiptCode} on ${bouncing.billCode} — the amount stops counting as paid`} danger confirmLabel="Mark bounced" onClose={() => setBouncing(null)}
          fields={[{ name: "note", label: "Why did it fail / bounce?", type: "textarea", required: true, maxLength: 200 }]}
          onSubmit={async (v) => {
            await mark(bouncing, "Bounced", String(v.note));
            setBouncing(null);
          }} />
      )}
    </Card>
  );
}

/* ======================= Daily cash closing ======================= */

interface ClosingData {
  date: string;
  summary: { byMode: { mode: string; collected: number; refunded: number; net: number }[]; byKind: { kind: string; amount: number; count: number }[]; cashiers: { name: string; collected: number; refunded: number }[]; collected: number; refunded: number; net: number; cashNet: number };
  shifts: (Shift & { totals: ShiftTotals | null })[];
  departments: { laboratory: { byMode: { mode: string; amount: number }[]; total: number }; pharmacy: { byMode: { mode: string; amount: number }[]; total: number } };
  closed: { closedByName: string; closedAt: string; cashDeposited?: number; depositReference?: string; notes?: string } | null;
}

function DayClosing() {
  const toast = useToast();
  const [date, setDate] = useState(today);
  const q = useApiQuery<ClosingData>(`/api/billing/closing${qs({ date })}`);
  const me = useApiQuery<{ role: string }>("/api/auth/me").data;
  const [dialog, setDialog] = useState<"close" | "reopen" | null>(null);
  const d = q.data;
  const openShifts = d?.shifts.filter((s) => s.status === "Open") ?? [];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <label className="text-xs font-medium text-slate-600">Date<input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} className={cx(inputClass, "mt-1")} /></label>
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" onClick={() => window.print()}><Printer className="size-4" /> Print</Button>
          {d && !d.closed && <Button onClick={() => setDialog("close")}><Lock className="size-4" /> Close day</Button>}
          {d?.closed && me?.role === "super_admin" && <Button variant="secondary" onClick={() => setDialog("reopen")}><LockOpen className="size-4" /> Reopen day</Button>}
        </div>
      </div>
      <Loading q={q} label="Totalling the day…">
        {(d) => (
          <>
            {d.closed ? <Alert tone="green">Closed by {d.closed.closedByName} on {formatDateTime(d.closed.closedAt)}{d.closed.cashDeposited != null ? ` · ${formatMoney(d.closed.cashDeposited)} deposited${d.closed.depositReference ? ` (${d.closed.depositReference})` : ""}` : ""}{d.closed.notes ? ` · ${d.closed.notes}` : ""}</Alert>
              : openShifts.length > 0 && <Alert tone="amber">Close these shifts before closing the day: {openShifts.map((s) => `${s.code} (${s.userName})`).join(", ")}.</Alert>}
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard label="Collected (billing)" value={formatMoney(d.summary.collected)} />
              <StatCard label="Refunded" value={formatMoney(d.summary.refunded)} tone={d.summary.refunded ? "amber" : "slate"} />
              <StatCard label="Net cash (billing)" value={formatMoney(d.summary.cashNet)} hint="To deposit / hand over" />
              <StatCard label="Lab + pharmacy" value={formatMoney(d.departments.laboratory.total + d.departments.pharmacy.total)} hint={`Lab ${formatMoney(d.departments.laboratory.total)} · pharmacy ${formatMoney(d.departments.pharmacy.total)}`} tone="slate" />
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <TableCard title="Billing by mode" headers={["Mode", "Collected", "Refunded", "Net"]} rows={d.summary.byMode.filter((m) => m.collected || m.refunded).map((m) => [m.mode, formatMoney(m.collected), formatMoney(m.refunded), formatMoney(m.net)])} empty="No billing receipts on this day." />
              <TableCard title="By receipt type" headers={["Type", "Receipts", "Amount"]} rows={d.summary.byKind.filter((k) => k.count).map((k) => [k.kind, k.count, formatMoney(k.amount)])} empty="No receipts." />
              <TableCard title="By cashier" headers={["Cashier", "Collected", "Refunded"]} rows={d.summary.cashiers.map((c) => [c.name, formatMoney(c.collected), formatMoney(c.refunded)])} empty="No receipts." />
              <TableCard title="Shifts" headers={["Shift", "Cashier", "Status", "Counted", "Difference"]} rows={d.shifts.map((s) => [s.code, s.userName, s.status, s.countedCash != null ? formatMoney(s.countedCash) : "—", s.difference != null ? formatMoney(s.difference) : "—"])} empty="No shifts on this day." />
              <TableCard title="Laboratory collections" headers={["Mode", "Net"]} rows={d.departments.laboratory.byMode.map((m) => [m.mode, formatMoney(m.amount)])} empty="No lab collections." />
              <TableCard title="Pharmacy collections" headers={["Mode", "Received"]} rows={d.departments.pharmacy.byMode.map((m) => [m.mode ?? "—", formatMoney(m.amount)])} empty="No pharmacy sales." />
            </div>
          </>
        )}
      </Loading>
      {dialog === "close" && d && (
        <FormModal title={`Close cash for ${formatDate(d.date)}`} description={`Net cash ${formatMoney(d.summary.cashNet)}. No more receipts can be taken for this day.`} confirmLabel="Close day" onClose={() => setDialog(null)}
          fields={[{ name: "cashDeposited", label: "Cash deposited (₹)", type: "number", min: 0, defaultValue: String(d.summary.cashNet) }, { name: "depositReference", label: "Deposit slip / reference", maxLength: 60 }, { name: "notes", label: "Notes", type: "textarea", maxLength: 300 }]}
          onSubmit={async (v) => {
            await api("/api/billing/closing", { method: "POST", body: { date: d.date, cashDeposited: numOrUndefined(v.cashDeposited), depositReference: v.depositReference, notes: v.notes } });
            toast("Day closed");
            setDialog(null);
            q.reload();
          }} />
      )}
      {dialog === "reopen" && d && (
        <FormModal title={`Reopen ${formatDate(d.date)}`} confirmLabel="Reopen day" onClose={() => setDialog(null)} fields={[{ name: "reason", label: "Reason", type: "textarea", required: true, maxLength: 300 }]}
          onSubmit={async (v) => {
            await api("/api/billing/closing/reopen", { method: "POST", body: { date: d.date, reason: v.reason } });
            toast("Day reopened");
            setDialog(null);
            q.reload();
          }} />
      )}
    </div>
  );
}

/* ======================= Reports ======================= */

interface Summary {
  from: string;
  to: string;
  totals: Record<string, number>;
  byType: { label: string; bills: number; net: number }[];
  byCategory: { label: string; charges: number; gross: number; discount: number; gst: number; amount: number }[];
  byMode: { mode: string; collected: number; refunded: number }[];
  byCashier: { name: string; collected: number; refunded: number }[];
  byPayer: { label: string; bills: number; net: number; payerShare: number; payerDue: number }[];
  gstSummary: { rate: number; taxable: number; cgst: number; sgst: number; gst: number }[];
  discounts: { id: string; code: string; date: string; patient: string; gross: number; discount: number; reason: string; approvedBy: string; by: string }[];
  cancellations: { id: string; code: string; date: string; patient: string; net: number; reason: string; by: string }[];
  writeOffs: number;
  daily: { date: string; bills: number; net: number; collected: number }[];
  register: { code: string; date: string; type: string; patient: string; patientCode: string; payer: string; gross: number; discount: number; gst: number; net: number; paid: number; patientDue: number; payerDue: number; status: string; paymentStatus: string }[];
}

function RangeBar({ from, to, setFrom, setTo, children }: { from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end gap-3 print:hidden">
      <label className="text-xs font-medium text-slate-600">From<input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className={cx(inputClass, "mt-1")} /></label>
      <label className="text-xs font-medium text-slate-600">To<input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className={cx(inputClass, "mt-1")} /></label>
      <div className="ml-auto flex gap-2">
        {children}
        <Button variant="secondary" onClick={() => window.print()}><Printer className="size-4" /> Print</Button>
      </div>
    </div>
  );
}

function BillingReports() {
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const q = useApiQuery<Summary>(`/api/billing/reports/summary${qs({ from, to })}`);
  const d = q.data;
  function exportRegister() {
    if (!d) return;
    downloadCsv(`bill-register_${d.from}_${d.to}.csv`, ["Bill", "Date", "Type", "Patient", "Patient ID", "Payer", "Gross", "Discount", "GST", "Net", "Paid", "Patient due", "Payer due", "Status", "Payment"],
      d.register.map((r) => [r.code, r.date.slice(0, 10), r.type, r.patient, r.patientCode, r.payer, r.gross, r.discount, r.gst, r.net, r.paid, r.patientDue, r.payerDue, r.status, r.paymentStatus]));
  }
  return (
    <div className="space-y-4">
      <RangeBar from={from} to={to} setFrom={setFrom} setTo={setTo}><Button variant="secondary" onClick={exportRegister} disabled={!d}><FileSpreadsheet className="size-4" /> Bill register (CSV)</Button></RangeBar>
      <Loading q={q} label="Preparing reports…">
        {(d) => (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard label="Billed (net)" value={formatMoney(d.totals.net)} hint={`${d.totals.bills} bill(s) · ${d.totals.final} final · ${d.totals.cancelled} cancelled`} />
              <StatCard label="Collected" value={formatMoney(d.totals.collected)} hint={`Settlements ${formatMoney(d.totals.settlements)} · refunds ${formatMoney(d.totals.refunded)}`} />
              <StatCard label="Discounts" value={formatMoney(d.totals.discount)} hint={`GST ${formatMoney(d.totals.gst)} · payer write-offs ${formatMoney(d.writeOffs)}`} tone="slate" />
              <StatCard label="Outstanding" value={formatMoney(d.totals.patientDue + d.totals.payerDue)} hint={`Patients ${formatMoney(d.totals.patientDue)} · payers ${formatMoney(d.totals.payerDue)}`} tone={d.totals.patientDue + d.totals.payerDue ? "amber" : "slate"} />
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <TableCard title="Revenue by billing head" headers={["Head", "Charges", "Gross", "Discount", "GST", "Amount"]} rows={d.byCategory.map((c) => [c.label, c.charges, formatMoney(c.gross), formatMoney(c.discount), formatMoney(c.gst), formatMoney(c.amount)])} empty="No charges in this period." />
              <TableCard title="Bills by type" headers={["Type", "Bills", "Net"]} rows={d.byType.map((t) => [t.label, t.bills, formatMoney(t.net)])} empty="No bills." />
              <TableCard title="Collections by mode" headers={["Mode", "Collected", "Refunded"]} rows={d.byMode.map((m) => [m.mode, formatMoney(m.collected), formatMoney(m.refunded)])} empty="No receipts." />
              <TableCard title="Collections by cashier" headers={["Cashier", "Collected", "Refunded"]} rows={d.byCashier.map((m) => [m.name, formatMoney(m.collected), formatMoney(m.refunded)])} empty="No receipts." />
              <TableCard title="By payer" headers={["Payer", "Bills", "Net", "Payer share", "Payer due"]} rows={d.byPayer.map((p) => [p.label, p.bills, formatMoney(p.net), formatMoney(p.payerShare), formatMoney(p.payerDue)])} empty="No bills." />
              <TableCard title="GST summary" headers={["Rate", "Taxable", "CGST", "SGST", "Total GST"]} rows={d.gstSummary.map((g) => [`${g.rate}%`, formatMoney(g.taxable), formatMoney(g.cgst), formatMoney(g.sgst), formatMoney(g.gst)])} empty="No taxable charges." />
              <TableCard title="Daily" headers={["Date", "Bills", "Net", "Collected"]} rows={d.daily.map((r) => [formatDate(r.date), r.bills, formatMoney(r.net), formatMoney(r.collected)])} empty="No bills." />
              <TableCard title="Discounts given" headers={["Bill", "Patient", "Discount", "Reason", "Approved by"]} rows={d.discounts.map((r) => [billLink(r.id, r.code), r.patient, formatMoney(r.discount), r.reason, r.approvedBy])} empty="No discounts." />
              <TableCard title="Cancelled bills" headers={["Bill", "Patient", "Net", "Reason", "By"]} rows={d.cancellations.map((r) => [billLink(r.id, r.code), r.patient, formatMoney(r.net), r.reason, r.by])} empty="No cancellations." />
            </div>
          </>
        )}
      </Loading>
    </div>
  );
}

/* ======================= Doctor fees ======================= */

interface FeesData {
  from: string;
  to: string;
  doctors: { id: string; name: string; services: number; billed: number; share: number; paid: number; balance: number; byType: Record<string, number> }[];
  totals: { billed: number; share: number; paid: number; balance: number };
  lines: { billId: string; code: string; date: string; patient: string; doctor: string; feeType: string; qty: number; amount: number; sharePct: number; share: number; status: string }[];
}

function DoctorFees() {
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const q = useApiQuery<FeesData>(`/api/billing/reports/doctor-fees${qs({ from, to })}`);
  const d = q.data;
  function exportLines() {
    if (!d) return;
    downloadCsv(`doctor-fees_${d.from}_${d.to}.csv`, ["Bill", "Date", "Patient", "Doctor", "Fee type", "Qty", "Amount", "Share %", "Share", "Bill status"],
      d.lines.map((l) => [l.code, l.date.slice(0, 10), l.patient, l.doctor, l.feeType, l.qty, l.amount, l.sharePct, l.share, l.status]));
  }
  return (
    <div className="space-y-4">
      <RangeBar from={from} to={to} setFrom={setFrom} setTo={setTo}>
        <Button variant="secondary" onClick={exportLines} disabled={!d}><FileSpreadsheet className="size-4" /> Fee lines (CSV)</Button>
        <Link href="/m/billing?tab=doctor_payouts"><Button variant="secondary"><Wallet className="size-4" /> Record payouts</Button></Link>
      </RangeBar>
      <Loading q={q} label="Totalling doctor fees…">
        {(d) => (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard label="Fees billed" value={formatMoney(d.totals.billed)} />
              <StatCard label="Doctors' share" value={formatMoney(d.totals.share)} hint="From each doctor's revenue share %" />
              <StatCard label="Paid out" value={formatMoney(d.totals.paid)} tone="slate" />
              <StatCard label="Balance payable" value={formatMoney(d.totals.balance)} tone={d.totals.balance > 0 ? "amber" : "slate"} />
            </div>
            <TableCard title="By doctor" headers={["Doctor", "Services", "Billed", "Share", "Paid", "Balance"]} rows={d.doctors.map((x) => [x.name, x.services, formatMoney(x.billed), formatMoney(x.share), formatMoney(x.paid), formatMoney(x.balance)])} empty="No doctor fees billed in this period." />
            <TableCard title="Fee lines" headers={["Bill", "Date", "Patient", "Doctor", "Fee", "Amount", "Share"]} rows={d.lines.map((l) => [billLink(l.billId, l.code), formatDate(l.date), l.patient, l.doctor, `${l.feeType} × ${l.qty}`, formatMoney(l.amount), `${formatMoney(l.share)} (${l.sharePct}%)`])} empty="No doctor fees." />
          </>
        )}
      </Loading>
    </div>
  );
}
