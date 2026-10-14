"use client";

import { AlertTriangle, FileCheck2, Plus, Printer, Search, ShieldCheck, Wallet } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { qs } from "@/lib/client";
import { downloadCsv } from "@/lib/csv";
import { formatDate, formatMoney } from "@/lib/format";
import { useApiQuery } from "@/lib/useApi";
import { TableCard } from "../TableCard";
import { Badge, Button, Card, EmptyState, ErrorState, Kbd, Pagination, Spinner, StatCard, cx, inputClass, statusTone, useDebounced, useHotkeys } from "../ui";

/** Bespoke insurance tabs: pre-auth and claim worklists, and reports. */
export function InsuranceSection({ section }: { section: string }) {
  if (section === "claims") return <ClaimsList />;
  if (section === "reports") return <InsuranceReports />;
  return <PreauthList />;
}

const th = "whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500";
const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => `${today().slice(0, 8)}01`;
export const PREAUTH_STATUSES = ["Draft", "Submitted", "Query Raised", "Approved", "Enhancement Requested", "Rejected", "Cancelled", "Claimed"];
export const CLAIM_STATUSES = ["Pending Submission", "Submitted", "Under Review", "Query Raised", "Approved", "Partially Settled", "Settled", "Rejected", "Cancelled"];

/** Tone for workflow statuses statusTone() does not know. */
export function insuranceTone(status: string) {
  if (status === "Claimed" || status === "Partially Settled") return "violet" as const;
  if (status === "Pending Submission" || status === "Draft") return "slate" as const;
  if (status === "Query Raised" || status === "Enhancement Requested") return "amber" as const;
  return statusTone(status);
}

function useListFilters() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const debounced = useDebounced(search);
  return { search, setSearch: (v: string) => { setSearch(v); setPage(1); }, status, setStatus: (v: string) => { setStatus(v); setPage(1); }, page, setPage, debounced };
}

/* ======================= Pre-auths ======================= */

interface PreauthRow {
  id: string;
  code: string;
  createdAt: string;
  patientName: string;
  patientCode: string | null;
  insurerName: string | null;
  tpaName: string | null;
  policyNumber: string | null;
  admissionCode: string | null;
  diagnosis: string;
  treatmentType: string | null;
  requestedAmount: number;
  approvedAmount: number;
  authNo: string | null;
  status: string;
  billCode: string | null;
  claimCode: string | null;
  openQuery: boolean;
}

function PreauthList() {
  const router = useRouter();
  const f = useListFilters();
  const searchRef = useRef<HTMLInputElement>(null);
  const q = useApiQuery<PreauthRow[]>(`/api/insurance/preauths${qs({ search: f.debounced, status: f.status, page: f.page })}`);
  const rows = q.data ?? [];
  useHotkeys({ F2: () => router.push("/insurance/preauth/new"), F3: () => searchRef.current?.focus() });
  return (
    <Card>
      <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <input ref={searchRef} value={f.search} onChange={(e) => f.setSearch(e.target.value)} placeholder="Pre-auth no., patient, policy, auth no., insurer…  (F3)" className={cx(inputClass, "pl-9")} aria-label="Search pre-authorisations" />
        </div>
        <select value={f.status} onChange={(e) => f.setStatus(e.target.value)} className={cx(inputClass, "sm:w-52")} aria-label="Status">
          <option value="">All statuses</option>
          <option value="Open">Awaiting insurer</option>
          {PREAUTH_STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <Link href="/insurance/preauth/new"><Button><Plus className="size-4" /> New pre-auth <Kbd>F2</Kbd></Button></Link>
      </div>
      {q.loading ? (
        <Spinner />
      ) : q.error ? (
        <ErrorState message={q.error} onRetry={q.reload} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={f.debounced || f.status ? "No matching pre-authorisations" : "No pre-authorisations yet"}
          description="Add the patient's policy under Patient Policies, then request cashless approval for the admission."
          action={<Link href="/insurance/preauth/new"><Button><Plus className="size-4" /> New pre-auth</Button></Link>}
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead className="bg-slate-50/60">
              <tr>{["Pre-auth", "Patient", "Insurer / TPA", "Diagnosis", "Requested", "Approved", "Status", ""].map((h, i) => <th key={i} className={th}>{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id} onClick={() => router.push(`/insurance/preauth/${r.id}`)} className="cursor-pointer hover:bg-brand-50/40">
                  <td className="whitespace-nowrap px-4 py-2.5"><span className="font-mono text-xs text-brand-700">{r.code}</span><span className="block text-xs text-slate-500">{formatDate(r.createdAt)}{r.admissionCode ? ` · ${r.admissionCode}` : ""}</span></td>
                  <td className="whitespace-nowrap px-4 py-2.5"><span className="font-medium text-slate-900">{r.patientName}</span><span className="ml-2 text-xs text-slate-500">{r.patientCode}</span></td>
                  <td className="px-4 py-2.5 text-slate-700">{r.insurerName}{r.tpaName && <span className="block text-xs text-slate-500">via {r.tpaName}</span>}</td>
                  <td className="max-w-[14rem] px-4 py-2.5 text-slate-700"><span className="block truncate" title={r.diagnosis}>{r.diagnosis}</span><span className="text-xs text-slate-500">{r.treatmentType}</span></td>
                  <td className="whitespace-nowrap px-4 py-2.5 tabular-nums">{formatMoney(r.requestedAmount)}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 tabular-nums">{r.approvedAmount ? formatMoney(r.approvedAmount) : "—"}{r.authNo && <span className="block font-mono text-[11px] text-slate-500">{r.authNo}</span>}</td>
                  <td className="whitespace-nowrap px-4 py-2.5">
                    <Badge tone={insuranceTone(r.status)}>{r.status}</Badge>
                    {r.openQuery && r.status !== "Query Raised" && <span className="ml-1"><Badge tone="amber">Query</Badge></span>}
                    {r.claimCode && <span className="block text-xs text-slate-500">Claim {r.claimCode}</span>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right text-xs text-brand-700">Open →</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!q.loading && !q.error && <Pagination pagination={q.pagination} onPage={f.setPage} />}
    </Card>
  );
}

/* ======================= Claims ======================= */

interface ClaimRow {
  id: string;
  code: string;
  claimType: string;
  patientName: string | null;
  patientCode: string | null;
  providerName: string | null;
  tpaName: string | null;
  policyNumber: string;
  billCode: string | null;
  claimAmount: number;
  approvedAmount: number | null;
  settledAmount: number;
  deductionAmount: number;
  outstanding: number;
  status: string;
  submittedDate: string | null;
  dueDate: string | null;
  createdAt: string | null;
  overdue: boolean;
  ageDays: number | null;
  missingDocs: number;
}

function ClaimsList() {
  const router = useRouter();
  const f = useListFilters();
  const searchRef = useRef<HTMLInputElement>(null);
  const q = useApiQuery<ClaimRow[]>(`/api/insurance/claims${qs({ search: f.debounced, status: f.status, page: f.page })}`);
  const rows = q.data ?? [];
  useHotkeys({ F2: () => router.push("/insurance/claims/new"), F3: () => searchRef.current?.focus() });
  return (
    <Card>
      <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <input ref={searchRef} value={f.search} onChange={(e) => f.setSearch(e.target.value)} placeholder="Claim no., patient, policy, bill, insurer…  (F3)" className={cx(inputClass, "pl-9")} aria-label="Search claims" />
        </div>
        <select value={f.status} onChange={(e) => f.setStatus(e.target.value)} className={cx(inputClass, "sm:w-52")} aria-label="Status">
          <option value="">All statuses</option>
          <option value="Outstanding">Outstanding with insurer</option>
          <option value="Overdue">Overdue</option>
          {CLAIM_STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <Link href="/insurance/claims/new"><Button><Plus className="size-4" /> New claim <Kbd>F2</Kbd></Button></Link>
      </div>
      <p className="border-b border-slate-100 px-4 py-2 text-xs text-slate-500">Cashless claims are raised automatically when an insurance bill is finalised in Billing. Settlements recorded here are posted to that bill.</p>
      {q.loading ? (
        <Spinner />
      ) : q.error ? (
        <ErrorState message={q.error} onRetry={q.reload} />
      ) : rows.length === 0 ? (
        <EmptyState title={f.debounced || f.status ? "No matching claims" : "No claims yet"} description="Finalise an insurance bill in Billing, or raise a reimbursement claim with F2." />
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead className="bg-slate-50/60">
              <tr>{["Claim", "Patient", "Insurer / TPA", "Claimed", "Settled", "Outstanding", "Submitted", "Status", ""].map((h, i) => <th key={i} className={th}>{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id} onClick={() => router.push(`/insurance/claims/${r.id}`)} className="cursor-pointer hover:bg-brand-50/40">
                  <td className="whitespace-nowrap px-4 py-2.5"><span className="font-mono text-xs text-brand-700">{r.code}</span><span className="block text-xs text-slate-500">{r.claimType}{r.billCode ? ` · ${r.billCode}` : ""}</span></td>
                  <td className="whitespace-nowrap px-4 py-2.5"><span className="font-medium text-slate-900">{r.patientName ?? "—"}</span><span className="ml-2 text-xs text-slate-500">{r.patientCode}</span><span className="block text-xs text-slate-500">{r.policyNumber}</span></td>
                  <td className="px-4 py-2.5 text-slate-700">{r.providerName ?? "—"}{r.tpaName && <span className="block text-xs text-slate-500">via {r.tpaName}</span>}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 tabular-nums">{formatMoney(r.claimAmount)}{r.approvedAmount != null && r.approvedAmount !== r.claimAmount && <span className="block text-xs text-slate-500">approved {formatMoney(r.approvedAmount)}</span>}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 tabular-nums">{formatMoney(r.settledAmount)}{r.deductionAmount > 0 && <span className="block text-xs text-red-600">−{formatMoney(r.deductionAmount)}</span>}</td>
                  <td className={cx("whitespace-nowrap px-4 py-2.5 font-medium tabular-nums", r.overdue ? "text-red-600" : "text-slate-900")}>{formatMoney(r.outstanding)}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">{r.submittedDate ? <>{formatDate(r.submittedDate)}<span className="block text-xs text-slate-500">{r.ageDays} days</span></> : "—"}</td>
                  <td className="whitespace-nowrap px-4 py-2.5">
                    <Badge tone={insuranceTone(r.status)}>{r.status}</Badge>
                    {r.overdue && <span className="ml-1 inline-flex items-center gap-0.5 text-xs font-semibold text-red-600"><AlertTriangle className="size-3.5" /> Overdue</span>}
                    {r.missingDocs > 0 && r.status === "Pending Submission" && <span className="block text-xs text-amber-700">{r.missingDocs} document(s) pending</span>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right text-xs text-brand-700">Open →</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!q.loading && !q.error && <Pagination pagination={q.pagination} onPage={f.setPage} />}
    </Card>
  );
}

/* ======================= Reports ======================= */

interface Reports {
  from: string;
  to: string;
  totals: Record<string, number | null>;
  buckets: string[];
  ageing: { label: string; claims: number; outstanding: number; overdue: number; buckets: Record<string, number> }[];
  claimStatus: { label: string; n: number }[];
  preauthStatus: { label: string; n: number }[];
  settlements: { claimId: string; code: string; insurer: string; at: string; amount: number; tds: number; deduction: number; toPatient: number; utr: string | null; reason: string | null }[];
  expiringPolicies: { id: string; policyNumber: string; validTo: string; patient: string; insurer: string }[];
}

function InsuranceReports() {
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const q = useApiQuery<Reports>(`/api/insurance/reports${qs({ from, to })}`);
  const d = q.data;
  function exportAgeing() {
    if (!d) return;
    downloadCsv(`claim-ageing_${d.to}.csv`, ["Insurer / TPA", "Claims", ...d.buckets, "Overdue", "Outstanding"], d.ageing.map((a) => [a.label, a.claims, ...d.buckets.map((b) => a.buckets[b]), a.overdue, a.outstanding]));
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <label className="text-xs font-medium text-slate-600">From<input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className={cx(inputClass, "mt-1")} /></label>
        <label className="text-xs font-medium text-slate-600">To<input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className={cx(inputClass, "mt-1")} /></label>
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" onClick={exportAgeing} disabled={!d?.ageing.length}>Ageing (CSV)</Button>
          <Button variant="secondary" onClick={() => window.print()}><Printer className="size-4" /> Print</Button>
        </div>
      </div>
      {q.loading ? (
        <Spinner label="Preparing reports…" />
      ) : q.error ? (
        <Card><ErrorState message={q.error} onRetry={q.reload} /></Card>
      ) : d ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Receivable from insurers" value={formatMoney(d.totals.outstanding)} hint={`${d.totals.openClaims} open claims · ${d.totals.notSubmitted} not yet submitted`} icon={<Wallet className="size-5" />} />
            <StatCard label="Overdue" value={formatMoney(d.totals.overdue)} hint="Past the insurer's settlement period" tone={d.totals.overdue ? "red" : "slate"} icon={<AlertTriangle className="size-5" />} />
            <StatCard label="Received in period" value={formatMoney(d.totals.received)} hint={`TDS ${formatMoney(d.totals.tds)} · deducted ${formatMoney(d.totals.deductions)} · to patients ${formatMoney(d.totals.toPatient)}`} icon={<FileCheck2 className="size-5" />} />
            <StatCard label="Deduction rate" value={d.totals.deductionPct === null ? "—" : `${d.totals.deductionPct}%`} hint={d.totals.avgSettlementDays === null ? "No claims settled" : `Settled in ${d.totals.avgSettlementDays} days on average`} tone={Number(d.totals.deductionPct) > 10 ? "amber" : "slate"} />
            <StatCard label="Claims raised" value={d.totals.claimsRaised} hint={`for ${formatMoney(d.totals.claimed)}`} />
            <StatCard label="Pre-auths" value={d.totals.preauths} hint={`${d.totals.enhancements} enhancement request(s)`} icon={<ShieldCheck className="size-5" />} />
            <StatCard label="Pre-auth approval rate" value={d.totals.preauthApprovalPct === null ? "—" : `${d.totals.preauthApprovalPct}%`} hint={`Approved ${formatMoney(d.totals.preauthApproved)} of ${formatMoney(d.totals.preauthRequested)}`} />
            <StatCard label="Pre-auth decision time" value={d.totals.avgDecisionHours === null ? "—" : `${d.totals.avgDecisionHours} h`} hint="Submission to insurer's decision" />
          </div>
          <TableCard title="Claim ageing by insurer" description="Outstanding with insurers today, by days since submission" headers={["Insurer / TPA", "Claims", ...d.buckets, "Overdue", "Outstanding"]}
            rows={d.ageing.map((a) => [a.label, a.claims, ...d.buckets.map((b) => (a.buckets[b] ? formatMoney(a.buckets[b]) : "—")), a.overdue ? <span key="o" className="font-semibold text-red-600">{formatMoney(a.overdue)}</span> : "—", <strong key="t">{formatMoney(a.outstanding)}</strong>])}
            empty="Nothing outstanding with insurers." />
          <div className="grid gap-4 lg:grid-cols-2">
            <TableCard title="Claims raised in period" headers={["Status", "Claims"]} rows={d.claimStatus.map((s) => [<Badge key={s.label} tone={insuranceTone(s.label)}>{s.label}</Badge>, s.n])} empty="No claims raised in this period." />
            <TableCard title="Pre-auths in period" headers={["Status", "Pre-auths"]} rows={d.preauthStatus.map((s) => [<Badge key={s.label} tone={insuranceTone(s.label)}>{s.label}</Badge>, s.n])} empty="No pre-auths in this period." />
          </div>
          <TableCard title="Settlements received" headers={["Claim", "Insurer", "Date", "Received", "TDS", "Deducted", "To patient", "UTR"]}
            rows={d.settlements.map((s) => [<Link key={s.claimId + s.at} href={`/insurance/claims/${s.claimId}`} className="font-mono text-xs text-brand-700 hover:underline">{s.code}</Link>, s.insurer, formatDate(s.at), formatMoney(s.amount), formatMoney(s.tds), formatMoney(s.deduction), formatMoney(s.toPatient), s.utr ?? "—"])}
            empty="No settlements in this period." />
          <TableCard title="Policies expiring in 30 days" headers={["Patient", "Insurer", "Policy", "Valid to"]} rows={d.expiringPolicies.map((p) => [p.patient, p.insurer, p.policyNumber, formatDate(p.validTo)])} empty="No policies expiring soon." />
        </>
      ) : null}
    </div>
  );
}
