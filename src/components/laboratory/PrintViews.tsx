"use client";

import { ArrowLeft, Printer } from "lucide-react";
import Link from "next/link";
import { useEffect, type ReactNode } from "react";
import { amountInWords } from "@/lib/billing-math";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { useApiQuery } from "@/lib/useApi";
import { Button, Card, EmptyState, ErrorState, Kbd, Spinner, cx, useHotkeys } from "../ui";
import { Barcode, type LabOrder } from "./shared";

const TITLES = { report: "Lab report", labels: "Sample labels", bill: "Lab bill" } as const;

/** Loads an order and renders a print-ready view with a small toolbar. */
export function PrintFrame({ url, kind, back, children }: { url: string; kind: keyof typeof TITLES; back?: string; children: (o: LabOrder) => ReactNode }) {
  const q = useApiQuery<LabOrder>(url);
  const o = q.data;
  useHotkeys({ "ctrl+p": () => window.print() });
  // The document title becomes the file name when saving as PDF.
  useEffect(() => {
    if (o) document.title = `${TITLES[kind]} ${o.code} - ${o.patientName}`;
  }, [o, kind]);

  if (q.error) return <Card className="mx-auto max-w-xl">{q.status === 404 ? <EmptyState title="Not found" description={q.error} /> : <ErrorState message={q.error} onRetry={q.reload} />}</Card>;
  if (!o) return <Spinner label="Loading…" />;
  return (
    <>
      <div className="mx-auto mb-4 flex max-w-4xl flex-wrap items-center justify-between gap-3 print:hidden">
        {back ? <Link href={back} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="size-4" /> Back to order</Link> : <span />}
        <div className="flex items-center gap-3">
          {kind === "report" && <span className="text-xs text-slate-500">Choose “Save as PDF” in the print dialog to download.</span>}
          <Button onClick={() => window.print()}><Printer className="size-4" /> Print / PDF <Kbd>Ctrl+P</Kbd></Button>
        </div>
      </div>
      {children(o)}
    </>
  );
}

/** 50 × 25 mm tube labels, one per sample (or just `only`). */
export function SampleLabels({ order, only }: { order: LabOrder; only?: string | null }) {
  const samples = order.samples.filter((s) => s.status !== "Rejected" && (!only || s.id === only));
  return (
    <>
      <style>{"@media print { @page { size: 50mm 25mm; margin: 0 } .lab-label { page-break-after: always; box-shadow: none !important; border: 0 !important } }"}</style>
      {samples.length === 0 && <Card className="mx-auto max-w-xl"><EmptyState title="No active samples to label" /></Card>}
      <div className="mx-auto flex max-w-4xl flex-wrap gap-4 print:block">
        {samples.map((s) => {
          const tests = order.items.filter((i) => i.sampleNo === s.accessionNo && i.status !== "Cancelled").map((i) => i.testCode || i.testName);
          return (
            <div key={s.id} className="lab-label flex h-[25mm] w-[50mm] flex-col justify-between overflow-hidden rounded border border-slate-300 bg-white px-[2mm] py-[1.2mm] text-black shadow-sm">
              <div className="flex justify-between gap-1 text-[7.5pt] font-bold leading-tight">
                <span className="truncate">{order.patientName}</span>
                <span className="shrink-0">{[order.patientAge != null ? `${order.patientAge}Y` : null, order.patientGender?.[0]].filter(Boolean).join("/")}</span>
              </div>
              <Barcode value={s.accessionNo} height={30} className="h-[8.5mm] w-full" />
              <div className="flex justify-between text-[7pt] leading-tight">
                <span className="font-mono font-bold">{s.accessionNo}</span>
                <span>{order.code.replace(/^LAB-/, "")}</span>
              </div>
              <div className="flex justify-between gap-1 text-[6.5pt] leading-tight">
                <span className="truncate">{s.sampleType} · {tests.join(",")}</span>
                <span className="shrink-0">{formatDate(s.collectedAt ?? order.orderDate).replace(/ \d{4}$/, "")}</span>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

/** Bill / receipt: profiles are billed as one line with their tests listed. */
export function LabBill({ order }: { order: LabOrder }) {
  const lines: { name: string; detail?: string; amount: number; cancelled: boolean }[] = [];
  const profiles = new Map<string, { name: string; tests: string[]; amount: number; cancelled: boolean }>();
  for (const i of order.items) {
    if (i.profileName) {
      const p = profiles.get(i.profileName) ?? { name: i.profileName, tests: [], amount: 0, cancelled: true };
      p.tests.push(i.status === "Cancelled" ? `${i.testCode || i.testName} (cancelled)` : i.testCode || i.testName);
      if (i.status !== "Cancelled") {
        p.amount += i.price;
        p.cancelled = false;
      }
      profiles.set(i.profileName, p);
    } else {
      lines.push({ name: i.testName, detail: i.testCode, amount: i.price, cancelled: i.status === "Cancelled" });
    }
  }
  for (const p of profiles.values()) lines.unshift({ name: `${p.name} (profile)`, detail: p.tests.join(", "), amount: Math.round(p.amount * 100) / 100, cancelled: p.cancelled });
  const balance = Math.max(0, (order.netAmount ?? 0) - (order.paidAmount ?? 0));

  return (
    <article className="mx-auto max-w-3xl bg-white p-8 text-slate-900 shadow-sm ring-1 ring-slate-200 print:max-w-none print:p-0 print:shadow-none print:ring-0">
      <header className="flex items-start justify-between gap-4 border-b-2 border-slate-800 pb-3">
        <div>
          <h1 className="text-xl font-bold">{order.lab.name}</h1>
          <p className="text-sm text-slate-700">{order.lab.department}</p>
          {order.lab.address && <p className="text-xs text-slate-600">{order.lab.address}</p>}
          {order.lab.phone && <p className="text-xs text-slate-600">Ph: {order.lab.phone}</p>}
        </div>
        <div className="text-right text-sm">
          <p className="font-bold uppercase tracking-wide">Lab bill / receipt</p>
          <p className="font-mono">{order.code}</p>
          <p className="text-slate-600">{formatDateTime(order.orderDate)}</p>
        </div>
      </header>
      <section className="grid grid-cols-2 gap-4 border-b border-slate-200 py-3 text-sm">
        <div>
          <p className="font-semibold">{order.patientName}</p>
          <p className="text-slate-600">{[order.patientCode, order.patientAge != null ? `${order.patientAge} yrs` : null, order.patientGender, order.patientMobile].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="text-right text-slate-600">
          <p>{[order.source, order.admissionCode ?? order.visitCode, order.wardBed].filter(Boolean).join(" · ")}</p>
          <p>Ref. by {order.doctorName ?? "Self"} · Plan: {order.ratePlan ?? "General"}</p>
        </div>
      </section>
      <table className="mt-3 w-full text-sm">
        <thead><tr className="border-b border-slate-300 text-left text-xs uppercase text-slate-500"><th className="py-1.5">#</th><th className="py-1.5">Test</th><th className="py-1.5 text-right">Amount</th></tr></thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i} className={cx("border-b border-slate-100", l.cancelled && "text-slate-400 line-through")}>
              <td className="py-1.5 pr-2 align-top text-slate-500">{i + 1}</td>
              <td className="py-1.5 pr-2">{l.name}{l.detail && <span className="block text-xs text-slate-500 no-underline">{l.detail}</span>}</td>
              <td className="py-1.5 text-right tabular-nums">{l.amount.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-4 grid grid-cols-2 gap-6">
        <div className="text-xs text-slate-600">
          <p className="font-medium text-slate-800">{amountInWords(order.netAmount ?? 0)}</p>
          {(order.payments ?? []).map((p, i) => <p key={i}>{p.kind === "Refund" ? "Refunded" : "Received"} {formatMoney(p.amount)} · {p.mode}{p.reference ? ` (${p.reference})` : ""} · {formatDateTime(p.at)}</p>)}
        </div>
        <dl className="space-y-1 text-sm tabular-nums">
          <div className="flex justify-between"><dt className="text-slate-600">Gross</dt><dd>{(order.grossAmount ?? 0).toFixed(2)}</dd></div>
          {(order.discount ?? 0) > 0 && <div className="flex justify-between"><dt className="text-slate-600">Discount</dt><dd>-{(order.discount ?? 0).toFixed(2)}</dd></div>}
          <div className="flex justify-between border-t-2 border-slate-800 pt-1 text-base font-bold"><dt>Net amount</dt><dd>{formatMoney(order.netAmount)}</dd></div>
          <div className="flex justify-between text-slate-600"><dt>Received</dt><dd>{formatMoney(order.paidAmount)}</dd></div>
          {balance > 0 && <div className="flex justify-between font-semibold text-amber-700"><dt>Balance due</dt><dd>{formatMoney(balance)}</dd></div>}
        </dl>
      </div>
      <footer className="mt-10 flex justify-between border-t border-slate-200 pt-3 text-xs text-slate-500">
        <p>Billed by {order.createdByName ?? "—"} · Payment status: {order.paymentStatus}</p>
        <p>Authorised signatory</p>
      </footer>
    </article>
  );
}
