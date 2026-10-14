"use client";

import { AlertTriangle, Ban, FileSpreadsheet, FlaskConical, PackageCheck, Plus, Printer, ScanBarcode, Search, Syringe, Tag } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ApiClientError, api, qs } from "@/lib/client";
import { downloadCsv } from "@/lib/csv";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { useApiQuery } from "@/lib/useApi";
import { Alert, Badge, Button, Card, EmptyState, ErrorState, Field, Kbd, Modal, Pagination, Spinner, StatCard, cx, inputClass, statusTone, useDebounced, useHotkeys, useToast } from "../ui";
import { TableCard } from "../TableCard";
import { REJECT_REASONS } from "./shared";

/** Bespoke laboratory tabs (worklists and analytics). */
export function LabSection({ section }: { section: string }) {
  if (section === "samples") return <SampleTracking />;
  if (section === "analytics") return <LabAnalytics />;
  return <OrdersList />;
}

const ORDER_STATUSES = ["Registered", "Sample Collected", "In Process", "Partially Reported", "Reported", "Cancelled"];
const PAYMENT_STATUSES = ["Unpaid", "Partially Paid", "Paid", "Refund Due", "Cancelled"];
const th = "whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500";

/* ======================= Orders worklist ======================= */

interface OrderRow {
  id: string;
  code: string;
  orderDate: string;
  patientName: string;
  patientCode?: string;
  patientAge?: number | null;
  patientGender?: string | null;
  source: string;
  doctorName?: string | null;
  priority: string;
  status: string;
  paymentStatus: string;
  netAmount: number;
  paidAmount: number;
  tests: number;
  approved: number;
  testCodes: string[];
  critical: boolean;
  abnormal: boolean;
}

function OrdersList() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [source, setSource] = useState("");
  const [paymentStatus, setPaymentStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const debounced = useDebounced(search);
  const searchRef = useRef<HTMLInputElement>(null);
  const q = useApiQuery<OrderRow[]>(`/api/laboratory/orders${qs({ search: debounced, status, source, paymentStatus, from, to, page })}`);
  const rows = q.data ?? [];
  useHotkeys({ F2: () => router.push("/laboratory/new"), F3: () => searchRef.current?.focus() });
  const reset = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(1);
  };

  return (
    <Card>
      <div className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-2 lg:grid-cols-7">
        <div className="relative sm:col-span-2">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <input ref={searchRef} value={search} onChange={(e) => reset(setSearch)(e.target.value)} placeholder="Lab no., patient, mobile, barcode…  (F3)" className={cx(inputClass, "pl-9")} aria-label="Search lab orders" />
        </div>
        <select value={status} onChange={(e) => reset(setStatus)(e.target.value)} className={inputClass} aria-label="Status">
          <option value="">All statuses</option>
          {ORDER_STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <select value={source} onChange={(e) => reset(setSource)(e.target.value)} className={inputClass} aria-label="Source">
          <option value="">OPD, IPD & walk-in</option>
          {["OPD", "IPD", "Walk-in"].map((s) => <option key={s}>{s}</option>)}
        </select>
        <select value={paymentStatus} onChange={(e) => reset(setPaymentStatus)(e.target.value)} className={inputClass} aria-label="Payment">
          <option value="">Any payment</option>
          {PAYMENT_STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <input type="date" value={from} max={to || undefined} onChange={(e) => reset(setFrom)(e.target.value)} className={inputClass} aria-label="From date" />
        <input type="date" value={to} min={from || undefined} onChange={(e) => reset(setTo)(e.target.value)} className={inputClass} aria-label="To date" />
      </div>
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-2.5">
        <p className="text-xs text-slate-500">Click an order to collect samples, enter results, approve, bill and print.</p>
        <Link href="/laboratory/new"><Button><Plus className="size-4" /> New lab booking <Kbd>F2</Kbd></Button></Link>
      </div>

      {q.loading ? (
        <Spinner />
      ) : q.error ? (
        <ErrorState message={q.error} onRetry={q.reload} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={debounced || status || source || paymentStatus || from || to ? "No matching lab orders" : "No lab orders yet"}
          description="Set up tests in Test Master first, then book tests for a patient with F2."
          action={<Link href="/laboratory/new"><Button><Plus className="size-4" /> New lab booking</Button></Link>}
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead className="bg-slate-50/60">
              <tr>{["Lab no.", "Date", "Patient", "Source", "Tests", "Doctor", "Status", "Bill", ""].map((h, i) => <th key={i} className={th}>{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id} onClick={() => router.push(`/laboratory/orders/${r.id}`)} className="cursor-pointer hover:bg-brand-50/40">
                  <td className="whitespace-nowrap px-4 py-2.5">
                    <span className="font-mono text-xs text-brand-700">{r.code}</span>
                    {r.priority !== "Routine" && <span className="ml-2"><Badge tone={r.priority === "STAT" ? "red" : "amber"}>{r.priority}</Badge></span>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">{formatDateTime(r.orderDate)}</td>
                  <td className="whitespace-nowrap px-4 py-2.5">
                    <span className="font-medium text-slate-900">{r.patientName}</span>
                    <span className="ml-2 text-xs text-slate-500">{[r.patientCode, r.patientAge != null ? `${r.patientAge}y` : null, r.patientGender?.[0]].filter(Boolean).join(" · ")}</span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">{r.source}</td>
                  <td className="max-w-[16rem] px-4 py-2.5 text-slate-700">
                    <span className="block truncate" title={r.testCodes.join(", ")}>{r.testCodes.join(", ")}</span>
                    <span className="text-xs text-slate-500">{r.approved}/{r.tests} reported</span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">{r.doctorName ?? "—"}</td>
                  <td className="whitespace-nowrap px-4 py-2.5">
                    <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                    {r.critical && <span className="ml-1.5 inline-flex items-center gap-0.5 text-xs font-semibold text-red-600" title="Critical values"><AlertTriangle className="size-3.5" /> Critical</span>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right">
                    <div className="tabular-nums text-slate-900">{formatMoney(r.netAmount)}</div>
                    <Badge tone={statusTone(r.paymentStatus)}>{r.paymentStatus}</Badge>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right text-xs text-brand-700">Open →</td>
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

/* ======================= Sample tracking ======================= */

interface SampleRow {
  orderId: string;
  labNo: string;
  orderDate: string;
  priority: string;
  source: string;
  wardBed?: string | null;
  patientName: string;
  patientCode?: string;
  patientAge?: number | null;
  patientGender?: string | null;
  sampleId: string;
  accessionNo: string;
  sampleType: string;
  container: string;
  status: string;
  collectedAt?: string | null;
  receivedAt?: string | null;
  rejectReason?: string | null;
  recollectOf?: string | null;
  tests: string[];
}

const SAMPLE_TABS = [
  { key: "Pending", label: "To collect" },
  { key: "Collected", label: "To receive" },
  { key: "Received", label: "Received" },
  { key: "Rejected", label: "Rejected" },
  { key: "", label: "All" },
];

function SampleTracking() {
  const toast = useToast();
  const [status, setStatus] = useState("Pending");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const debounced = useDebounced(search);
  const q = useApiQuery<SampleRow[]>(`/api/laboratory/samples${qs({ status, search: debounced, page })}`);
  const rows = q.data ?? [];
  const [scan, setScan] = useState("");
  const [scanMode, setScanMode] = useState<"collect" | "receive">("receive");
  const [scanMsg, setScanMsg] = useState<{ tone: "green" | "red"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<SampleRow | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);

  async function act(row: SampleRow, action: "collect" | "receive") {
    setBusy(row.sampleId);
    try {
      await api(`/api/laboratory/orders/${row.orderId}/samples/${row.sampleId}`, { method: "POST", body: { action } });
      toast(`${action === "collect" ? "Collected" : "Received"} ${row.accessionNo}`);
      q.reload();
      return true;
    } catch (e) {
      toast((e as Error).message, "error");
      return false;
    } finally {
      setBusy(null);
    }
  }

  // A barcode scanner types the accession number and presses Enter.
  async function onScan(e: React.FormEvent) {
    e.preventDefault();
    const code = scan.trim();
    if (!code) return;
    setScan("");
    setScanMsg(null);
    try {
      const { data } = await api<SampleRow[]>(`/api/laboratory/samples${qs({ search: code })}`);
      const row = data.find((r) => r.accessionNo === code);
      if (!row) return setScanMsg({ tone: "red", text: `No sample with barcode ${code}` });
      await api(`/api/laboratory/orders/${row.orderId}/samples/${row.sampleId}`, { method: "POST", body: { action: scanMode } });
      setScanMsg({ tone: "green", text: `${scanMode === "collect" ? "Collected" : "Received"} ${code} — ${row.patientName} (${row.tests.join(", ")})` });
      q.reload();
    } catch (err) {
      setScanMsg({ tone: "red", text: `${code}: ${(err as Error).message}` });
    } finally {
      scanRef.current?.focus();
    }
  }

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <form onSubmit={onScan} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Field label="Scan sample barcode" htmlFor="scan" className="flex-1" hint="Scan or type the accession number and press Enter.">
            <div className="relative">
              <ScanBarcode className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
              <input id="scan" ref={scanRef} autoFocus value={scan} onChange={(e) => setScan(e.target.value)} inputMode="numeric" autoComplete="off" placeholder="e.g. 2600000001" className={cx(inputClass, "pl-9 font-mono")} />
            </div>
          </Field>
          <div className="flex gap-1 rounded-lg bg-slate-100 p-1" role="radiogroup" aria-label="Scan action">
            {(["collect", "receive"] as const).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={scanMode === m} onClick={() => setScanMode(m)} className={cx("rounded-md px-3 py-1.5 text-sm font-medium", scanMode === m ? "bg-white text-brand-700 shadow-sm" : "text-slate-600")}>
                {m === "collect" ? "Mark collected" : "Receive in lab"}
              </button>
            ))}
          </div>
          <Button type="submit">Apply</Button>
        </form>
        {scanMsg && <div className="mt-3"><Alert tone={scanMsg.tone}>{scanMsg.text}</Alert></div>}
      </Card>

      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 lg:flex-row lg:items-center">
          <div className="flex gap-1 overflow-x-auto rounded-lg bg-slate-100 p-1" role="tablist">
            {SAMPLE_TABS.map((t) => (
              <button key={t.key || "all"} role="tab" aria-selected={status === t.key} onClick={() => { setStatus(t.key); setPage(1); }} className={cx("whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium", status === t.key ? "bg-white text-brand-700 shadow-sm" : "text-slate-600 hover:text-slate-900")}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Lab no., patient or accession no." className={cx(inputClass, "pl-9")} aria-label="Search samples" />
          </div>
        </div>
        {q.loading ? (
          <Spinner />
        ) : q.error ? (
          <ErrorState message={q.error} onRetry={q.reload} />
        ) : rows.length === 0 ? (
          <EmptyState title="No samples here" description={status === "Pending" ? "New bookings create samples to collect." : "Nothing matches this filter."} />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead className="bg-slate-50/60">
                <tr>{["Accession", "Patient", "Sample", "Tests", "Lab no.", "Status", ""].map((h, i) => <th key={i} className={th}>{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.sampleId} className="hover:bg-slate-50/60">
                    <td className="whitespace-nowrap px-4 py-2.5">
                      <span className="font-mono text-xs font-semibold text-slate-900">{r.accessionNo}</span>
                      {r.priority !== "Routine" && <span className="ml-2"><Badge tone={r.priority === "STAT" ? "red" : "amber"}>{r.priority}</Badge></span>}
                      {r.recollectOf && <div className="text-[11px] text-amber-700">Recollection of {r.recollectOf}</div>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      <div className="font-medium text-slate-900">{r.patientName}</div>
                      <div className="text-xs text-slate-500">{[r.patientCode, r.patientAge != null ? `${r.patientAge}y` : null, r.patientGender, r.source === "IPD" ? r.wardBed : r.source].filter(Boolean).join(" · ")}</div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-slate-700">{r.sampleType}<div className="text-xs text-slate-500">{r.container}</div></td>
                    <td className="max-w-[14rem] truncate px-4 py-2.5 text-slate-700" title={r.tests.join(", ")}>{r.tests.join(", ") || "—"}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs"><Link href={`/laboratory/orders/${r.orderId}`} className="text-brand-700 hover:underline">{r.labNo}</Link></td>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                      <div className="mt-0.5 text-[11px] text-slate-500">
                        {r.status === "Rejected" ? r.rejectReason : r.receivedAt ? `Received ${formatDateTime(r.receivedAt)}` : r.collectedAt ? `Collected ${formatDateTime(r.collectedAt)}` : `Booked ${formatDateTime(r.orderDate)}`}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right">
                      <div className="flex justify-end gap-1.5">
                        <Link href={`/laboratory/orders/${r.orderId}/labels?sample=${r.sampleId}`} target="_blank" className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-brand-700" title="Print label"><Tag className="size-4" /></Link>
                        {r.status === "Pending" && <Button variant="secondary" loading={busy === r.sampleId} onClick={() => act(r, "collect")}><Syringe className="size-4" /> Collect</Button>}
                        {r.status === "Collected" && <Button variant="secondary" loading={busy === r.sampleId} onClick={() => act(r, "receive")}><PackageCheck className="size-4" /> Receive</Button>}
                        {(r.status === "Collected" || r.status === "Received") && (
                          <button onClick={() => setRejecting(r)} className="rounded p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600" title="Reject sample"><Ban className="size-4" /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!q.loading && !q.error && <Pagination pagination={q.pagination} onPage={setPage} />}
      </Card>

      {rejecting && (
        <RejectSampleModal
          url={`/api/laboratory/orders/${rejecting.orderId}/samples/${rejecting.sampleId}`}
          accessionNo={rejecting.accessionNo}
          onClose={() => setRejecting(null)}
          onDone={() => { setRejecting(null); toast("Sample rejected — recollection requested"); q.reload(); }}
        />
      )}
    </div>
  );
}

export function RejectSampleModal({ url, accessionNo, onClose, onDone }: { url: string; accessionNo: string; onClose: () => void; onDone: (data: unknown) => void }) {
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const { data } = await api(url, { method: "POST", body: { action: "reject", reason, note } });
      onDone(data);
    } catch (e) {
      setError(e instanceof ApiClientError && e.fields ? Object.values(e.fields)[0] : (e as Error).message);
      setBusy(false);
    }
  }
  return (
    <Modal open onClose={onClose} size="md" title={`Reject sample ${accessionNo}?`} description="A new sample with a new barcode will be requested for recollection."
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Keep sample</Button><Button variant="danger" onClick={submit} loading={busy}>Reject & recollect</Button></>}>
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <Field label="Reason" htmlFor="rej-reason" required>
          <select id="rej-reason" value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass}>
            <option value="">Select…</option>
            {REJECT_REASONS.map((r) => <option key={r}>{r}</option>)}
          </select>
        </Field>
        <Field label="Note" htmlFor="rej-note" required={reason === "Other"}>
          <input id="rej-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} className={inputClass} />
        </Field>
      </div>
    </Modal>
  );
}

/* ======================= Reports & analytics ======================= */

interface Analytics {
  from: string;
  to: string;
  totals: Record<string, number | null>;
  bySource: { label: string; n: number }[];
  byStatus: { label: string; n: number }[];
  byCategory: { label: string; tests: number; revenue: number; avgTatHours: number | null }[];
  topTests: { name: string; tests: number; revenue: number }[];
  rejectionReasons: { label: string; n: number }[];
  outsourcedByLab: { label: string; n: number }[];
  daily: { date: string; orders: number; billed: number }[];
  pending: { label: string; n: number }[];
  qc: { runs: number; pass: number; warning: number; fail: number; recentFailures: { id: string; code: string; runDate: string; analyte: string; level: string; equipment: string; zScore: number; result: string; rule: string }[] };
  equipmentDue: { id: string; name: string; status: string; nextCalibrationDue: string | null; nextServiceDue: string | null }[];
  reagentAlerts: { id: string; name: string; lotNo: string | null; quantity: number; unit: string; status: string; expiryDate: string | null }[];
  register: Record<string, string | number | null>[];
}

const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => `${today().slice(0, 8)}01`;
const hrs = (h: number | null | undefined) => (h == null ? "—" : h < 48 ? `${h.toFixed(1)} h` : `${(h / 24).toFixed(1)} d`);

function LabAnalytics() {
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const q = useApiQuery<Analytics>(`/api/laboratory/analytics${qs({ from, to })}`);
  const d = q.data;

  function exportRegister() {
    if (!d) return;
    downloadCsv(
      `lab-register_${d.from}_${d.to}.csv`,
      ["Lab no.", "Date", "Patient", "Patient ID", "Source", "Test", "Category", "Status", "Amount", "Approved at", "TAT (hours)", "Flag", "Outsourced to"],
      d.register.map((r) => [r.labNo, formatDateTime(String(r.date)), r.patient, r.patientCode, r.source, r.test, r.category, r.status, r.price, r.approvedAt ? formatDateTime(String(r.approvedAt)) : "", r.tatHours, r.flag, r.outsourcedTo])
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <label className="text-xs font-medium text-slate-600">From<input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className={cx(inputClass, "mt-1")} /></label>
        <label className="text-xs font-medium text-slate-600">To<input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className={cx(inputClass, "mt-1")} /></label>
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" onClick={exportRegister} disabled={!d}><FileSpreadsheet className="size-4" /> Test register (CSV)</Button>
          <Button variant="secondary" onClick={() => window.print()}><Printer className="size-4" /> Print</Button>
        </div>
      </div>
      <h2 className="hidden text-lg font-bold print:block">Laboratory report {d ? `${formatDate(d.from)} – ${formatDate(d.to)}` : ""}</h2>

      {q.loading ? (
        <Spinner label="Preparing analytics…" />
      ) : q.error ? (
        <Card><ErrorState message={q.error} onRetry={q.reload} /></Card>
      ) : d ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Lab orders" value={d.totals.orders} hint={`${d.totals.tests} tests · ${d.totals.cancelledTests} cancelled`} icon={<FlaskConical className="size-5" />} />
            <StatCard label="Billed" value={formatMoney(d.totals.billed)} hint={`Collected ${formatMoney(d.totals.collected)} · discount ${formatMoney(d.totals.discount)}`} />
            <StatCard label="Outstanding" value={formatMoney(d.totals.outstanding)} hint={d.totals.refundDue ? `Refund due ${formatMoney(d.totals.refundDue)}` : "No refunds due"} tone={d.totals.outstanding ? "amber" : "brand"} />
            <StatCard label="Turnaround (booking → approval)" value={hrs(d.totals.avgTatHours)} hint={`Median ${hrs(d.totals.medianTatHours)} · ${d.totals.reportedTests} reported`} />
            <StatCard label="Abnormal results" value={d.totals.abnormal} hint={`${d.totals.critical} critical`} tone={d.totals.critical ? "red" : "slate"} />
            <StatCard label="Sample rejection rate" value={`${d.totals.rejectionRate}%`} hint={`${d.totals.rejectedSamples} of ${d.totals.samples} samples`} tone={Number(d.totals.rejectionRate) > 5 ? "red" : "slate"} />
            <StatCard label="Outsourced tests" value={d.totals.outsourced} />
            <StatCard label="QC runs" value={d.qc.runs} hint={`${d.qc.pass} pass · ${d.qc.warning} warning · ${d.qc.fail} fail`} tone={d.qc.fail ? "red" : "slate"} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <TableCard title="Pending worklist" description="All open tests, not limited to the date range" headers={["Stage", "Tests"]} rows={d.pending.map((p) => [p.label, p.n])} empty="Nothing pending." />
            <TableCard title="Orders by source" headers={["Source", "Orders"]} rows={d.bySource.map((p) => [p.label, p.n])} empty="No orders in this period." />
            <TableCard title="Category-wise" headers={["Category", "Tests", "Revenue", "Avg TAT"]} rows={d.byCategory.map((c) => [c.label, c.tests, formatMoney(c.revenue), hrs(c.avgTatHours)])} empty="No tests in this period." />
            <TableCard title="Top tests" headers={["Test", "Count", "Revenue"]} rows={d.topTests.map((t) => [t.name, t.tests, formatMoney(t.revenue)])} empty="No tests in this period." />
            <TableCard title="Sample rejections" headers={["Reason", "Samples"]} rows={d.rejectionReasons.map((p) => [p.label, p.n])} empty="No rejected samples." />
            <TableCard title="Outsourced by lab" headers={["Lab", "Tests"]} rows={d.outsourcedByLab.map((p) => [p.label, p.n])} empty="No tests sent out." />
            <TableCard title="Daily summary" headers={["Date", "Orders", "Billed"]} rows={d.daily.map((p) => [formatDate(p.date), p.orders, formatMoney(p.billed)])} empty="No orders in this period." />
            <TableCard title="Order status" headers={["Status", "Orders"]} rows={d.byStatus.map((p) => [<Badge key={p.label} tone={statusTone(p.label)}>{p.label}</Badge>, p.n])} empty="No orders in this period." />
            <TableCard title="QC warnings & failures" headers={["Run", "Analyte", "Level", "Analyser", "SDI", "Rule"]}
              rows={d.qc.recentFailures.map((f) => [`${f.code} · ${formatDate(f.runDate)}`, f.analyte, f.level, f.equipment, f.zScore, <Badge key={f.id} tone={statusTone(f.result)}>{f.rule}</Badge>])} empty="All QC runs passed." />
            <TableCard title="Equipment needing attention" description="Calibration or service due within 30 days, or not working" headers={["Equipment", "Status", "Calibration due", "Service due"]}
              rows={d.equipmentDue.map((e) => [e.name, <Badge key={e.id} tone={statusTone(e.status)}>{e.status}</Badge>, formatDate(e.nextCalibrationDue), formatDate(e.nextServiceDue)])} empty="All equipment is up to date." />
            <TableCard title="Reagent & consumable alerts" description="Low, out of stock, expired or expiring within 30 days" headers={["Item", "Lot", "Stock", "Expiry", "Status"]}
              rows={d.reagentAlerts.map((r) => [r.name, r.lotNo ?? "—", `${r.quantity} ${r.unit}`, formatDate(r.expiryDate), <Badge key={r.id} tone={statusTone(r.status)}>{r.status}</Badge>])} empty="Stock levels are fine." />
          </div>
        </>
      ) : null}
    </div>
  );
}
