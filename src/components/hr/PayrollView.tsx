"use client";

import { ArrowLeft, Banknote, CheckCheck, FileSpreadsheet, FileText, Pencil, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client";
import { downloadCsv } from "@/lib/csv";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { useApiQuery } from "@/lib/useApi";
import { FormModal, numOrUndefined } from "../FormModal";
import { Alert, Badge, Button, Card, CardHeader, ConfirmDialog, EmptyState, ErrorState, Spinner, StatCard, cx, statusTone, useToast } from "../ui";
import { monthLabel } from "./HrSection";

export interface PayLine {
  _id: string;
  staff: string;
  staffCode?: string;
  name: string;
  department?: string;
  designation?: string;
  category?: string;
  joiningDate?: string;
  salaryMode?: string;
  bankName?: string;
  accountNo?: string;
  ifsc?: string;
  pan?: string;
  uan?: string;
  esiNumber?: string;
  monthDays: number;
  payableDays: number;
  lopDays: number;
  presentDays: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  absentDays: number;
  holidays: number;
  weekOffs: number;
  unmarkedDays: number;
  notEmployedDays: number;
  otHours: number;
  grossRate: number;
  basicRate: number;
  basic: number;
  da: number;
  hra: number;
  special: number;
  other: number;
  overtime: number;
  otherEarnings: number;
  grossEarned: number;
  pf: number;
  esi: number;
  pt: number;
  tds: number;
  advance: number;
  recoveries: { code: string; amount: number }[];
  otherDeductions: number;
  totalDeductions: number;
  employerPf: number;
  employerEsi: number;
  netPay: number;
  remarks?: string;
}

export interface PayrollRun {
  id: string;
  code: string;
  month: string;
  status: "Draft" | "Finalised" | "Paid";
  monthDays: number;
  unmarkedAsPresent: boolean;
  lines: PayLine[];
  totals: Record<string, number>;
  generatedAt?: string;
  generatedByName?: string;
  finalisedAt?: string;
  finalisedByName?: string;
  paidOn?: string;
  paymentReference?: string;
  paidByName?: string;
  monthInProgress: boolean;
  hospital: { name: string; address: string };
}

type Dialog = { kind: "adjust"; line: PayLine } | { kind: "reopen" | "pay" | "finalise" | "delete" | "regenerate" };

export function PayrollView({ id }: { id: string }) {
  const router = useRouter();
  const toast = useToast();
  const q = useApiQuery<PayrollRun>(`/api/hr/payroll/${id}`);
  const [latest, setLatest] = useState<PayrollRun | null>(null);
  const run = latest?.id === id ? latest : q.data;
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const back = (
    <Link href="/m/hr?tab=payroll" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 print:hidden">
      <ArrowLeft className="size-4" /> Back to payroll
    </Link>
  );
  if (q.error) return <>{back}<Card>{q.status === 404 ? <EmptyState title="Payroll run not found" /> : <ErrorState message={q.error} onRetry={q.reload} />}</Card></>;
  if (!run) return <>{back}<Spinner label="Loading payroll…" /></>;

  const act = async (body: Record<string, unknown>, msg: string) => {
    const { data } = await api<PayrollRun>(`/api/hr/payroll/${id}/action`, { method: "POST", body });
    setLatest(data);
    setDialog(null);
    toast(msg);
  };
  async function confirm(kind: "finalise" | "delete" | "regenerate") {
    setBusy(true);
    setConfirmError(null);
    try {
      if (kind === "finalise") await act({ action: "finalise" }, `Payroll ${run!.code} finalised`);
      else if (kind === "regenerate") {
        const { data } = await api<PayrollRun>("/api/hr/payroll", { method: "POST", body: { month: run!.month, unmarkedAsPresent: run!.unmarkedAsPresent } });
        setLatest(data);
        setDialog(null);
        toast("Payroll recalculated from the latest attendance and salaries");
      } else {
        await api(`/api/hr/payroll/${id}`, { method: "DELETE" });
        toast(`Draft ${run!.code} deleted`);
        router.push("/m/hr?tab=payroll");
      }
    } catch (e) {
      setConfirmError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const t = run.totals ?? {};
  const draft = run.status === "Draft";
  const bankRows = run.lines.filter((l) => l.salaryMode === "Bank Transfer" && l.netPay > 0);

  function exportRegister() {
    downloadCsv(
      `payroll-register_${run!.month}.csv`,
      ["Emp ID", "Name", "Department", "Designation", "Month days", "Payable days", "LOP days", "OT hours", "Basic", "DA", "HRA", "Special", "Other", "Overtime", "Other earnings", "Gross", "PF", "ESI", "PT", "TDS", "Advance", "Other deductions", "Total deductions", "Net pay", "Employer PF", "Employer ESI", "UAN", "ESI no.", "PAN", "Remarks"],
      run!.lines.map((l) => [l.staffCode, l.name, l.department, l.designation, l.monthDays, l.payableDays, l.lopDays, l.otHours, l.basic, l.da, l.hra, l.special, l.other, l.overtime, l.otherEarnings, l.grossEarned, l.pf, l.esi, l.pt, l.tds, l.advance, l.otherDeductions, l.totalDeductions, l.netPay, l.employerPf, l.employerEsi, l.uan, l.esiNumber, l.pan, l.remarks])
    );
  }
  function exportBank() {
    downloadCsv(
      `bank-advice_${run!.month}.csv`,
      ["Beneficiary name", "Account no.", "IFSC", "Bank", "Amount", "Narration"],
      bankRows.map((l) => [l.name, l.accountNo, l.ifsc, l.bankName, l.netPay, `Salary ${run!.month} ${l.staffCode ?? ""}`])
    );
  }

  return (
    <>
      {back}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-slate-900">Payroll · {monthLabel(run.month)}</h1>
            <span className="font-mono text-sm text-slate-500">{run.code}</span>
            <Badge tone={statusTone(run.status === "Finalised" ? "approved" : run.status)}>{run.status}</Badge>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Prepared {formatDateTime(run.generatedAt)} by {run.generatedByName ?? "—"}
            {run.finalisedAt && ` · finalised ${formatDateTime(run.finalisedAt)} by ${run.finalisedByName}`}
            {run.paidOn && ` · paid ${formatDate(run.paidOn)}${run.paymentReference ? ` (ref ${run.paymentReference})` : ""}`}
            {` · unmarked days counted as ${run.unmarkedAsPresent ? "present" : "loss of pay"}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/hr/payroll/${run.id}/payslips`} target="_blank"><Button variant="secondary"><FileText className="size-4" /> Payslips</Button></Link>
          <Button variant="secondary" onClick={exportRegister}><FileSpreadsheet className="size-4" /> Register</Button>
          <Button variant="secondary" onClick={exportBank} disabled={!bankRows.length}><Banknote className="size-4" /> Bank advice</Button>
          {draft && <Button variant="secondary" onClick={() => setDialog({ kind: "regenerate" })}><RefreshCw className="size-4" /> Recalculate</Button>}
          {draft && <Button onClick={() => setDialog({ kind: "finalise" })}><CheckCheck className="size-4" /> Finalise</Button>}
          {run.status === "Finalised" && <Button onClick={() => setDialog({ kind: "pay" })}><Banknote className="size-4" /> Mark salaries paid</Button>}
          {run.status === "Finalised" && <Button variant="secondary" onClick={() => setDialog({ kind: "reopen" })}><RotateCcw className="size-4" /> Reopen</Button>}
          {draft && <Button variant="secondary" className="text-red-600" onClick={() => setDialog({ kind: "delete" })}><Trash2 className="size-4" /> Delete draft</Button>}
        </div>
      </div>

      {run.monthInProgress && draft && <div className="mb-4"><Alert tone="amber">This month has not ended yet. Recalculate after the last day so attendance and leave are complete.</Alert></div>}

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Net pay" value={formatMoney(t.net)} hint={`${t.staff ?? 0} employees`} />
        <StatCard label="Gross earnings" value={formatMoney(t.gross)} hint={`Overtime ${formatMoney(t.overtime)} · LOP ${t.lopDays ?? 0} days`} />
        <StatCard label="Deductions" value={formatMoney(t.deductions)} hint={`PF ${formatMoney(t.pf)} · ESI ${formatMoney(t.esi)} · PT ${formatMoney(t.pt)} · TDS ${formatMoney(t.tds)} · advances ${formatMoney(t.advance)}`} tone="slate" />
        <StatCard label="Cost to company" value={formatMoney(t.ctc)} hint={`Employer PF ${formatMoney(t.employerPf)} · ESI ${formatMoney(t.employerEsi)}`} tone="slate" />
      </div>

      <Card>
        <CardHeader title="Employees" description={draft ? "Adjust arrears, bonus, other deductions or TDS before finalising. Days come from attendance and leave." : "Finalised: reopen to make changes."} />
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead className="bg-slate-50/60">
              <tr>
                {["Employee", "Days paid", "LOP", "Gross", "PF", "ESI", "PT", "TDS", "Advance", "Other", "Net pay", ""].map((h, i) => (
                  <th key={i} className={cx("whitespace-nowrap px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500", i === 0 ? "text-left" : "text-right")}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {run.lines.map((l) => (
                <tr key={l._id} className="hover:bg-slate-50/60">
                  <td className="whitespace-nowrap px-3 py-2">
                    <span className="font-medium text-slate-900">{l.name}</span> <span className="font-mono text-xs text-slate-500">{l.staffCode}</span>
                    <span className="block text-xs text-slate-500">{l.designation} · {l.department}{l.remarks ? ` · ${l.remarks}` : ""}</span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums" title={`Present ${l.presentDays}, paid leave ${l.paidLeaveDays}, holidays ${l.holidays}, week-offs ${l.weekOffs}`}>{l.payableDays}/{l.monthDays}</td>
                  <td className={cx("px-3 py-2 text-right tabular-nums", l.lopDays > 0 && "font-medium text-red-600")} title={`Absent ${l.absentDays}, unpaid leave ${l.unpaidLeaveDays}, unmarked ${l.unmarkedDays}, not employed ${l.notEmployedDays}`}>{l.lopDays}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatMoney(l.grossEarned)}{l.otherEarnings > 0 && <span className="block text-[11px] text-emerald-700">+{formatMoney(l.otherEarnings)}</span>}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatMoney(l.pf)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatMoney(l.esi)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatMoney(l.pt)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatMoney(l.tds)}</td>
                  <td className="px-3 py-2 text-right tabular-nums" title={l.recoveries.map((r) => `${r.code}: ₹${r.amount}`).join(", ")}>{formatMoney(l.advance)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatMoney(l.otherDeductions)}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-900">{formatMoney(l.netPay)}</td>
                  <td className="px-3 py-2 text-right">
                    {draft && <button onClick={() => setDialog({ kind: "adjust", line: l })} className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-brand-700" aria-label={`Adjust ${l.name}`}><Pencil className="size-4" /></button>}
                    <Link href={`/hr/payroll/${run.id}/payslips?staff=${l.staff}`} target="_blank" className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-brand-700" title="Payslip"><FileText className="inline size-4" /></Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {dialog?.kind === "adjust" && (
        <FormModal
          title={`Adjust ${dialog.line.name}`}
          description={`Gross ${formatMoney(dialog.line.grossEarned)} · net ${formatMoney(dialog.line.netPay)}`}
          fields={[
            { name: "otherEarnings", label: "Arrears / bonus / incentive", type: "number", min: 0, defaultValue: String(dialog.line.otherEarnings ?? 0) },
            { name: "otherDeductions", label: "Other deductions", type: "number", min: 0, defaultValue: String(dialog.line.otherDeductions ?? 0), hint: "e.g. canteen, uniform, mess" },
            { name: "tds", label: "Income tax (TDS)", type: "number", min: 0, defaultValue: String(dialog.line.tds ?? 0) },
            { name: "remarks", label: "Remarks", maxLength: 200, defaultValue: dialog.line.remarks ?? "", hint: "Required when adding an earning or deduction" },
          ]}
          onClose={() => setDialog(null)}
          onSubmit={(v) => act({ action: "adjust", line: dialog.line._id, otherEarnings: numOrUndefined(v.otherEarnings) ?? 0, otherDeductions: numOrUndefined(v.otherDeductions) ?? 0, tds: numOrUndefined(v.tds) ?? 0, remarks: v.remarks }, `${dialog.line.name} updated`)}
        />
      )}
      {dialog?.kind === "pay" && (
        <FormModal
          title="Mark salaries paid"
          description={`${formatMoney(t.net)} to ${t.staff} employees`}
          fields={[
            { name: "paidOn", label: "Paid on", type: "date", required: true, defaultValue: new Date().toISOString().slice(0, 10) },
            { name: "reference", label: "Bank batch / cheque reference", maxLength: 60 },
          ]}
          confirmLabel="Mark paid"
          onClose={() => setDialog(null)}
          onSubmit={(v) => act({ action: "pay", paidOn: v.paidOn, reference: v.reference }, "Salaries marked paid")}
        />
      )}
      {dialog?.kind === "reopen" && (
        <FormModal
          title="Reopen payroll?"
          description="Advance recoveries are reversed and attendance for the month is unlocked."
          fields={[{ name: "reason", label: "Reason", required: true, maxLength: 300 }]}
          confirmLabel="Reopen"
          danger
          onClose={() => setDialog(null)}
          onSubmit={(v) => act({ action: "reopen", reason: v.reason }, "Payroll reopened")}
        />
      )}
      <ConfirmDialog
        open={dialog?.kind === "finalise" || dialog?.kind === "delete" || dialog?.kind === "regenerate"}
        danger={dialog?.kind === "delete"}
        title={dialog?.kind === "finalise" ? "Finalise payroll?" : dialog?.kind === "regenerate" ? "Recalculate payroll?" : "Delete draft payroll?"}
        message={
          dialog?.kind === "finalise"
            ? <>Locks attendance, leave and holidays for {monthLabel(run.month)} and recovers {formatMoney(t.advance)} of salary advances. Net pay {formatMoney(t.net)}.</>
            : dialog?.kind === "regenerate"
              ? <>Rebuilds every line from the latest attendance, leave, holidays, salary structures and advances. Arrears, other deductions, TDS and remarks you entered are kept.</>
              : <>The draft {run.code} is removed. You can prepare it again at any time.</>
        }
        confirmLabel={dialog?.kind === "finalise" ? "Finalise" : dialog?.kind === "regenerate" ? "Recalculate" : "Delete"}
        loading={busy}
        error={confirmError}
        onConfirm={() => confirm(dialog!.kind as "finalise" | "delete" | "regenerate")}
        onClose={() => { setDialog(null); setConfirmError(null); }}
      />
    </>
  );
}
