"use client";

import { ArrowLeft, Printer } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { amountInWords } from "@/lib/billing-math";
import { durationLabel, type InvoiceView } from "@/lib/control-shared";
import { formatDate, formatMoney } from "@/lib/format";
import { Button, Card, EmptyState, ErrorState, Kbd, Spinner, useHotkeys } from "../ui";

/** Print-ready tax invoice for a licence payment (Control Panel and the hospital's own copy). */
export function InvoiceDocument({ data, error, status, onRetry, backHref, backLabel }: { data?: InvoiceView; error?: string | null; status?: number; onRetry?: () => void; backHref: string; backLabel: string }) {
  useHotkeys({ "ctrl+p": () => window.print() });
  useEffect(() => {
    if (data) document.title = `Invoice ${data.payment.code} - ${data.customer.name}`;
  }, [data]);

  if (error) return <Card className="mx-auto max-w-xl">{status === 404 ? <EmptyState title="Invoice not found" description={error} /> : <ErrorState message={error} onRetry={onRetry} />}</Card>;
  if (!data) return <Spinner label="Loading invoice…" />;
  const { payment: p, vendor: v, customer: c } = data;
  const half = p.gst / 2;

  return (
    <>
      <div className="mx-auto mb-4 flex max-w-3xl flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={backHref} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="size-4" /> {backLabel}</Link>
        <Button onClick={() => window.print()}><Printer className="size-4" /> Print / PDF <Kbd>Ctrl+P</Kbd></Button>
      </div>
      <article className="mx-auto max-w-3xl bg-white p-8 text-slate-900 shadow-sm ring-1 ring-slate-200 print:max-w-none print:p-0 print:shadow-none print:ring-0">
        <header className="flex items-start justify-between gap-4 border-b-2 border-slate-800 pb-3">
          <div>
            <h1 className="text-xl font-bold">{v.name}</h1>
            {v.address && <p className="whitespace-pre-line text-xs text-slate-600">{v.address}</p>}
            <p className="text-xs text-slate-600">{[v.phone && `Ph: ${v.phone}`, v.email, v.website].filter(Boolean).join(" · ")}</p>
            {v.gstin && <p className="text-xs text-slate-600">GSTIN: {v.gstin}</p>}
          </div>
          <div className="text-right text-sm">
            <p className="font-bold uppercase tracking-wide">{p.gst > 0 ? "Tax invoice" : "Invoice"}</p>
            <p className="font-mono">{p.code}</p>
            <p className="text-slate-600">{formatDate(p.paidAt)}</p>
          </div>
        </header>
        <section className="grid grid-cols-2 gap-4 border-b border-slate-200 py-3 text-sm">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Billed to</p>
            <p className="font-semibold">{c.name}</p>
            {c.address && <p className="whitespace-pre-line text-slate-600">{c.address}</p>}
            {c.city && <p className="text-slate-600">{c.city}</p>}
            {c.gstin && <p className="text-slate-600">GSTIN: {c.gstin}</p>}
          </div>
          <div className="text-right text-slate-600">
            <p>Client {c.code}</p>
            {c.contactName && <p>{c.contactName}</p>}
            <p>{[c.phone, c.email].filter(Boolean).join(" · ")}</p>
          </div>
        </section>
        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="border-b border-slate-300 text-left text-xs uppercase tracking-wide text-slate-500"><th className="py-1.5">Description</th><th className="py-1.5 text-right">Amount</th></tr>
          </thead>
          <tbody>
            <tr className="border-b border-slate-100">
              <td className="py-2">
                <p className="font-medium">Smart Hospital software licence — {p.plan.name} plan ({durationLabel(p.durationDays)})</p>
                <p className="text-xs text-slate-500">Licence period {formatDate(p.periodFrom)} – {formatDate(p.periodTo)} · SAC 997331</p>
              </td>
              <td className="py-2 text-right tabular-nums">{formatMoney(p.price)}</td>
            </tr>
            {p.discount > 0 && <tr><td className="py-1 text-slate-600">Discount{p.couponCode ? ` (coupon ${p.couponCode})` : ""}</td><td className="py-1 text-right tabular-nums">− {formatMoney(p.discount)}</td></tr>}
            <tr><td className="py-1 text-slate-600">Taxable value</td><td className="py-1 text-right tabular-nums">{formatMoney(p.taxable)}</td></tr>
            {p.gst > 0 && (
              <>
                <tr><td className="py-1 text-slate-600">CGST {p.gstPct / 2}%</td><td className="py-1 text-right tabular-nums">{formatMoney(Math.round(half * 100) / 100)}</td></tr>
                <tr><td className="py-1 text-slate-600">SGST {p.gstPct / 2}%</td><td className="py-1 text-right tabular-nums">{formatMoney(Math.round((p.gst - Math.round(half * 100) / 100) * 100) / 100)}</td></tr>
              </>
            )}
            <tr className="border-t-2 border-slate-800 font-semibold"><td className="py-2">Total</td><td className="py-2 text-right tabular-nums">{formatMoney(p.total)}</td></tr>
          </tbody>
        </table>
        <p className="mt-1 text-xs text-slate-600">{amountInWords(p.total)}</p>
        <section className="mt-6 grid grid-cols-2 gap-4 text-xs text-slate-600">
          <div>
            <p>Paid by {p.method}{p.reference ? ` · ${p.reference}` : ""}</p>
            <p>Received {formatDate(p.paidAt)}</p>
          </div>
          <p className="text-right">For {v.name}<br /><br />Authorised signatory</p>
        </section>
        <p className="mt-6 border-t border-slate-200 pt-2 text-center text-[11px] text-slate-400">Computer-generated invoice. For inter-state supply, IGST at {p.gstPct}% applies in place of CGST + SGST.</p>
      </article>
    </>
  );
}
