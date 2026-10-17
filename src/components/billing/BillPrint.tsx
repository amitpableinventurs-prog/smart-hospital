"use client";

import { ArrowLeft, Printer } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { amountInWords } from "@/lib/billing-math";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { useApiQuery } from "@/lib/useApi";
import { Button, Card, EmptyState, ErrorState, Kbd, Spinner, useHotkeys } from "../ui";
import type { Bill } from "./types";

/** Print-ready hospital bill with charges grouped by billing head, and the receipts. */
export function BillPrint({ id }: { id: string }) {
  const q = useApiQuery<Bill>(`/api/billing/bills/${id}`);
  const b = q.data;
  useHotkeys({ "ctrl+p": () => window.print() });
  useEffect(() => {
    if (b) document.title = `Bill ${b.code} - ${b.patientName}`;
  }, [b]);

  if (q.error) return <Card className="mx-auto max-w-xl">{q.status === 404 ? <EmptyState title="Bill not found" description={q.error} /> : <ErrorState message={q.error} onRetry={q.reload} />}</Card>;
  if (!b) return <Spinner label="Loading…" />;

  const lines = b.lines.filter((l) => l.status !== "Cancelled");
  const heads = [...new Set(lines.map((l) => l.category))];
  const gst = lines.filter((l) => (l.gstRate ?? 0) > 0);
  const title = b.status === "Provisional" ? "Provisional bill / interim statement" : b.status === "Cancelled" ? "Cancelled bill" : b.gstAmount > 0 ? "Tax invoice" : "Final bill";
  let n = 0;

  return (
    <>
      <div className="mx-auto mb-4 flex max-w-4xl flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/billing/bills/${id}`} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="size-4" /> Back to bill</Link>
        <Button onClick={() => window.print()}><Printer className="size-4" /> Print / PDF <Kbd>Ctrl+P</Kbd></Button>
      </div>
      <article className="mx-auto max-w-4xl bg-white p-8 text-slate-900 shadow-sm ring-1 ring-slate-200 print:max-w-none print:p-0 print:shadow-none print:ring-0">
        <header className="flex items-start justify-between gap-4 border-b-2 border-slate-800 pb-3">
          <div>
            <h1 className="text-xl font-bold">{b.hospital.name}</h1>
            {b.hospital.address && <p className="text-xs text-slate-600">{b.hospital.address}</p>}
            {b.hospital.phone && <p className="text-xs text-slate-600">Ph: {b.hospital.phone}</p>}
            {b.hospital.gstin && <p className="text-xs text-slate-600">GSTIN: {b.hospital.gstin}</p>}
          </div>
          <div className="text-right text-sm">
            <p className="font-bold uppercase tracking-wide">{title}</p>
            <p className="font-mono">{b.code}</p>
            <p className="text-slate-600">{formatDate(b.billDate)}</p>
          </div>
        </header>
        <section className="grid grid-cols-2 gap-4 border-b border-slate-200 py-3 text-sm">
          <div>
            <p className="font-semibold">{b.patientName}</p>
            <p className="text-slate-600">{[b.patientCode, b.patientAge != null ? `${b.patientAge} yrs` : null, b.patientGender, b.patientMobile].filter(Boolean).join(" · ")}</p>
            {b.payerType !== "Self" && <p className="text-slate-600">{b.payerType}: {b.payerName}{b.policyNo ? ` · ${b.policyNo}` : ""}{b.tpaName ? ` · TPA ${b.tpaName}` : ""}</p>}
          </div>
          <div className="text-right text-slate-600">
            <p>{[b.billType, b.admissionCode ?? b.visitCode, b.wardBed].filter(Boolean).join(" · ")}</p>
            {b.admissionDate && <p>Admitted {formatDate(b.admissionDate)}{b.dischargeDate ? ` · discharged ${formatDate(b.dischargeDate)}` : ""}{b.stayDays ? ` · ${b.stayDays} day(s)` : ""}</p>}
            <p>Consultant: {b.doctorName ?? "—"}{b.department ? ` · ${b.department}` : ""}</p>
          </div>
        </section>
        <table className="mt-3 w-full text-sm">
          <thead><tr className="border-b border-slate-300 text-left text-xs uppercase text-slate-500"><th className="py-1.5">#</th><th className="py-1.5">Particulars</th><th className="py-1.5 text-right">Qty</th><th className="py-1.5 text-right">Rate</th><th className="py-1.5 text-right">Disc.</th><th className="py-1.5 text-right">Amount</th></tr></thead>
          <tbody>
            {heads.map((h) => {
              const rows = lines.filter((l) => l.category === h);
              return [
                <tr key={h} className="bg-slate-50 print:bg-transparent"><td colSpan={5} className="pt-2 text-xs font-semibold uppercase tracking-wide text-slate-600">{h}</td><td className="pt-2 text-right text-xs font-semibold tabular-nums text-slate-600">{rows.reduce((s, l) => s + l.amount, 0).toFixed(2)}</td></tr>,
                ...rows.map((l) => (
                  <tr key={l.id} className="border-b border-slate-100">
                    <td className="py-1 pr-2 align-top text-slate-500">{++n}</td>
                    <td className="py-1 pr-2">{l.name}{l.detail && <span className="block text-xs text-slate-500">{l.detail}</span>}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{l.qty}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{l.rate.toFixed(2)}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{l.discount > 0 ? l.discount.toFixed(2) : ""}</td>
                    <td className="py-1 text-right tabular-nums">{l.amount.toFixed(2)}</td>
                  </tr>
                )),
              ];
            })}
          </tbody>
        </table>
        <div className="mt-4 grid grid-cols-2 gap-6">
          <div className="space-y-2 text-xs text-slate-600">
            <p className="font-medium text-slate-800">{amountInWords(b.netAmount)}</p>
            {gst.length > 0 && <p>GST: {[...new Set(gst.map((l) => l.gstRate))].map((r) => `${r}% on ${formatMoney(gst.filter((l) => l.gstRate === r).reduce((s, l) => s + l.taxable, 0))} (CGST + SGST)`).join("; ")}</p>}
            {b.discountReason && b.discountAmount > 0 && <p>Discount: {b.discountReason}</p>}
            {b.receipts.map((r) => (
              <p key={r.id}>{r.kind === "Refund" ? "Refunded" : r.kind === "Settlement" ? `Settled by ${b.payerName}` : `${r.kind} received`} {formatMoney(r.amount)} · {r.code}{r.splits.length ? ` · ${r.splits.map((s) => `${s.mode}${s.reference ? ` ${s.reference}` : ""}${s.recon === "Bounced" ? " (bounced)" : ""}`).join(" + ")}` : ""} · {formatDateTime(r.at)}</p>
            ))}
          </div>
          <dl className="space-y-1 text-sm tabular-nums">
            <div className="flex justify-between"><dt className="text-slate-600">Gross</dt><dd>{b.grossAmount.toFixed(2)}</dd></div>
            {b.discountAmount > 0 && <div className="flex justify-between"><dt className="text-slate-600">Discount</dt><dd>-{b.discountAmount.toFixed(2)}</dd></div>}
            {b.gstAmount > 0 && <div className="flex justify-between"><dt className="text-slate-600">GST</dt><dd>{b.gstAmount.toFixed(2)}</dd></div>}
            {b.roundOff !== 0 && <div className="flex justify-between"><dt className="text-slate-600">Round off</dt><dd>{b.roundOff.toFixed(2)}</dd></div>}
            <div className="flex justify-between border-t-2 border-slate-800 pt-1 text-base font-bold"><dt>Net amount</dt><dd>{formatMoney(b.netAmount)}</dd></div>
            {b.payerType !== "Self" && <div className="flex justify-between text-slate-600"><dt>{b.payerName} share</dt><dd>{formatMoney(b.payerShare)}</dd></div>}
            <div className="flex justify-between text-slate-600"><dt>Patient share</dt><dd>{formatMoney(b.patientShare)}</dd></div>
            <div className="flex justify-between text-slate-600"><dt>Paid by patient</dt><dd>{formatMoney(b.patientPaid)}</dd></div>
            {b.patientDue > 0 && <div className="flex justify-between font-semibold text-amber-700"><dt>Balance due</dt><dd>{formatMoney(b.patientDue)}</dd></div>}
            {b.refundDue > 0 && <div className="flex justify-between font-semibold text-amber-700"><dt>Refund due</dt><dd>{formatMoney(b.refundDue)}</dd></div>}
          </dl>
        </div>
        <footer className="mt-10 flex justify-between border-t border-slate-200 pt-3 text-xs text-slate-500">
          <p>Prepared by {b.createdByName ?? "—"}{b.finalizedByName ? ` · finalised by ${b.finalizedByName}` : ""} · {b.paymentStatus}</p>
          <p>Authorised signatory</p>
        </footer>
      </article>
    </>
  );
}
