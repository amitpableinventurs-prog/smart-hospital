"use client";

import { ArrowLeft, Printer } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { amountInWords } from "@/lib/billing-math";
import { formatDate, formatMoney } from "@/lib/format";
import { useApiQuery } from "@/lib/useApi";
import { Button, Card, EmptyState, ErrorState, Kbd, Spinner, useHotkeys } from "../ui";
import { monthLabel } from "./HrSection";
import type { PayLine, PayrollRun } from "./PayrollView";

/** Print-ready payslips: one per page, for the whole run or one employee. */
export function Payslips({ id, staff }: { id: string; staff?: string | null }) {
  const q = useApiQuery<PayrollRun>(`/api/hr/payroll/${id}`);
  const run = q.data;
  const lines = run?.lines.filter((l) => !staff || l.staff === staff) ?? [];
  useHotkeys({ "ctrl+p": () => window.print() });
  const single = lines.length === 1 ? lines[0].name : null;
  // The document title becomes the file name when saving as PDF.
  useEffect(() => {
    if (run) document.title = `Payslip ${run.month}${single ? ` - ${single}` : ""}`;
  }, [run, single]);

  if (q.error) return <Card className="mx-auto max-w-xl">{q.status === 404 ? <EmptyState title="Not found" description={q.error} /> : <ErrorState message={q.error} onRetry={q.reload} />}</Card>;
  if (!run) return <Spinner label="Loading…" />;
  return (
    <>
      <style>{"@media print { .payslip { page-break-after: always; box-shadow: none !important; border: 0 !important } }"}</style>
      <div className="mx-auto mb-4 flex max-w-3xl flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/hr/payroll/${run.id}`} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="size-4" /> Back to payroll</Link>
        <div className="flex items-center gap-3">
          {run.status === "Draft" && <span className="text-xs font-medium text-amber-700">Draft — figures may still change</span>}
          <Button onClick={() => window.print()}><Printer className="size-4" /> Print / PDF <Kbd>Ctrl+P</Kbd></Button>
        </div>
      </div>
      {lines.length === 0 && <Card className="mx-auto max-w-xl"><EmptyState title="No payslip for this employee in this run" /></Card>}
      <div className="mx-auto max-w-3xl space-y-6 print:space-y-0">
        {lines.map((l) => <Payslip key={l._id} run={run} line={l} />)}
      </div>
    </>
  );
}

function Payslip({ run, line: l }: { run: PayrollRun; line: PayLine }) {
  const earnings: [string, number][] = [
    ["Basic", l.basic],
    ["Dearness allowance", l.da],
    ["House rent allowance", l.hra],
    ["Special allowance", l.special],
    ["Other allowances", l.other],
    [`Overtime (${l.otHours} h)`, l.overtime],
    ["Arrears / bonus", l.otherEarnings],
  ];
  const deductions: [string, number][] = [
    ["Provident fund", l.pf],
    ["ESI", l.esi],
    ["Professional tax", l.pt],
    ["Income tax (TDS)", l.tds],
    [`Advance recovery${l.recoveries.length ? ` (${l.recoveries.map((r) => r.code).join(", ")})` : ""}`, l.advance],
    ["Other deductions", l.otherDeductions],
  ];
  const shown = (rows: [string, number][]) => rows.filter(([, v]) => v > 0);
  const info: [string, string | number | undefined][] = [
    ["Employee ID", l.staffCode],
    ["Designation", l.designation],
    ["Department", l.department],
    ["Date of joining", l.joiningDate ? formatDate(l.joiningDate) : undefined],
    ["PAN", l.pan],
    ["PF UAN", l.uan],
    ["ESI no.", l.esiNumber],
    ["Paid by", l.salaryMode === "Bank Transfer" && l.accountNo ? `${l.bankName ?? "Bank"} ·· ${l.accountNo.slice(-4)}` : l.salaryMode],
  ];
  return (
    <div className="payslip rounded-lg border border-slate-300 bg-white p-8 text-[13px] text-black shadow-sm">
      <div className="border-b-2 border-slate-800 pb-3 text-center">
        <p className="text-lg font-bold uppercase tracking-wide">{run.hospital.name}</p>
        {run.hospital.address && <p className="text-xs">{run.hospital.address}</p>}
        <p className="mt-2 text-sm font-semibold">Payslip for {monthLabel(run.month)}</p>
      </div>
      <div className="mt-4 flex items-baseline justify-between">
        <p className="text-base font-semibold">{l.name}</p>
        {run.status === "Draft" && <p className="text-xs font-semibold uppercase text-amber-700">Draft</p>}
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1">
        {info.filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => (
          <div key={k} className="flex justify-between gap-2 border-b border-dotted border-slate-300"><dt className="text-slate-600">{k}</dt><dd className="font-medium">{v}</dd></div>
        ))}
      </dl>
      <div className="mt-4 grid grid-cols-4 gap-2 rounded border border-slate-300 p-2 text-center text-xs">
        <div><p className="text-slate-600">Days in month</p><p className="font-semibold">{l.monthDays}</p></div>
        <div><p className="text-slate-600">Paid days</p><p className="font-semibold">{l.payableDays}</p></div>
        <div><p className="text-slate-600">Loss of pay</p><p className="font-semibold">{l.lopDays}</p></div>
        <div><p className="text-slate-600">Leave (paid / unpaid)</p><p className="font-semibold">{l.paidLeaveDays} / {l.unpaidLeaveDays}</p></div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-4">
        {(
          [
            ["Earnings", shown(earnings), l.grossEarned, "Gross earnings"],
            ["Deductions", shown(deductions), l.totalDeductions, "Total deductions"],
          ] as const
        ).map(([title, rows, total, label]) => (
          <table key={title} className="w-full border border-slate-300">
            <thead><tr className="bg-slate-100"><th className="px-2 py-1 text-left">{title}</th><th className="px-2 py-1 text-right">Amount</th></tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td className="px-2 py-1 text-slate-500" colSpan={2}>—</td></tr>}
              {rows.map(([k, v]) => <tr key={k}><td className="px-2 py-1">{k}</td><td className="px-2 py-1 text-right tabular-nums">{formatMoney(v)}</td></tr>)}
              <tr className="border-t border-slate-300 font-semibold"><td className="px-2 py-1">{label}</td><td className="px-2 py-1 text-right tabular-nums">{formatMoney(total)}</td></tr>
            </tbody>
          </table>
        ))}
      </div>
      <div className="mt-4 rounded border-2 border-slate-800 p-3">
        <p className="flex justify-between text-base font-bold"><span>Net pay</span><span className="tabular-nums">{formatMoney(l.netPay)}</span></p>
        <p className="mt-1 text-xs">{amountInWords(l.netPay)}</p>
      </div>
      <p className="mt-6 text-center text-[11px] text-slate-500">Computer-generated payslip ({run.code}); no signature required. Employer PF {formatMoney(l.employerPf)}{l.employerEsi ? ` · employer ESI ${formatMoney(l.employerEsi)}` : ""}.</p>
    </div>
  );
}
