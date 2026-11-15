"use client";

import { Fragment } from "react";
import { amountInWords } from "@/lib/billing-math";
import { printLogo, type BillPrintSettings } from "@/lib/bill-print";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { cx } from "../ui";
import type { Bill, BillLine, BillReceipt } from "./types";

/**
 * The printed bill in the hospital's chosen template (Modern, Classic or Thermal 80 mm).
 * Rendered on the print page and, with a sample bill, as the live preview in Bill Print Templates.
 */
export function BillDocument({ bill, settings }: { bill: Bill; settings: BillPrintSettings }) {
  const view = billView(bill, settings);
  const page =
    settings.template === "compact" ? "size: 80mm auto; margin: 3mm" : settings.paper === "A5" ? "size: A5; margin: 8mm" : "size: A4; margin: 10mm";
  return (
    <>
      <style>{`@media print { @page { ${page} } } .bill-doc, .bill-doc * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }`}</style>
      {settings.template === "classic" ? <Classic v={view} /> : settings.template === "compact" ? <Compact v={view} /> : <Modern v={view} />}
    </>
  );
}

/* ---------- shared view model ---------- */

type View = ReturnType<typeof billView>;

function billView(b: Bill, s: BillPrintSettings) {
  const lines = b.lines.filter((l) => l.status !== "Cancelled");
  const heads = [...new Set(lines.map((l) => l.category))].map((h) => {
    const rows = lines.filter((l) => l.category === h);
    return { head: h, rows, total: rows.reduce((t, l) => t + l.amount, 0) };
  });
  const gstLines = lines.filter((l) => (l.gstRate ?? 0) > 0);
  const gst = [...new Set(gstLines.map((l) => l.gstRate ?? 0))].map((rate) => {
    const of = gstLines.filter((l) => l.gstRate === rate);
    return { rate, taxable: of.reduce((t, l) => t + l.taxable, 0), tax: of.reduce((t, l) => t + l.gst, 0) };
  });
  const title = b.status === "Provisional" ? "Provisional bill" : b.status === "Cancelled" ? "Cancelled bill" : b.gstAmount > 0 ? "Tax invoice" : "Final bill";
  const stamp =
    b.status === "Cancelled" ? { text: "Cancelled", tone: "red" as const }
    : b.status === "Provisional" ? { text: "Provisional", tone: "amber" as const }
    : b.patientDue <= 0 && b.patientShare > 0 ? { text: "Paid", tone: "green" as const }
    : b.patientDue > 0 && b.patientPaid > 0 ? { text: "Part paid", tone: "amber" as const }
    : null;
  const terms = s.terms.split(/\r?\n/).map((t) => t.trim()).filter(Boolean);
  return {
    b,
    s,
    lines,
    heads,
    gst,
    title,
    stamp: s.showStamp ? stamp : null,
    logo: printLogo(s, b.hospital),
    terms,
    footer: s.footer || b.hospital.footer || "",
    contact: [b.hospital.phone && `Ph: ${b.hospital.phone}`, b.hospital.email, b.hospital.website].filter(Boolean).join("  ·  "),
    patientMeta: [b.patientCode, b.patientAge != null ? `${b.patientAge} yrs` : null, b.patientGender, b.patientMobile].filter(Boolean).join(" · "),
    visit: [b.billType, b.admissionCode ?? b.visitCode, b.wardBed].filter(Boolean).join(" · "),
    stay: b.admissionDate ? `Admitted ${formatDate(b.admissionDate)}${b.dischargeDate ? ` · discharged ${formatDate(b.dischargeDate)}` : ""}${b.stayDays ? ` · ${b.stayDays} day(s)` : ""}` : "",
    payer: b.payerType !== "Self" ? `${b.payerType}: ${b.payerName ?? "—"}${b.policyNo ? ` · Policy ${b.policyNo}` : ""}${b.tpaName ? ` · TPA ${b.tpaName}` : ""}` : "",
    receipts: s.showReceipts ? b.receipts : [],
    style: { "--accent": s.accent, "--accent-soft": `color-mix(in srgb, ${s.accent} 9%, white)`, "--accent-line": `color-mix(in srgb, ${s.accent} 30%, white)` } as React.CSSProperties,
  };
}

const logoSize = { sm: "max-h-10 max-w-24", md: "max-h-16 max-w-36", lg: "max-h-24 max-w-48" } as const;
const money = (n: number) => n.toFixed(2);
const receiptLabel = (r: BillReceipt, b: Bill) => (r.kind === "Refund" ? "Refund" : r.kind === "Settlement" ? `Settlement · ${b.payerName ?? "payer"}` : r.kind);
const receiptModes = (r: BillReceipt) => r.splits.map((x) => `${x.mode}${x.reference ? ` ${x.reference}` : ""}${x.recon === "Bounced" ? " (bounced)" : ""}`).join(" + ") || "—";
const discLabel = (l: BillLine) => (l.discount > 0 ? money(l.discount) : "");

function Logo({ v, className }: { v: View; className?: string }) {
  if (!v.logo) return null;
  // eslint-disable-next-line @next/next/no-img-element -- a data URL or same-origin logo; next/image adds nothing for print.
  return <img src={v.logo} alt="" className={cx("shrink-0 object-contain", logoSize[v.s.logoSize], className)} />;
}

const stampTone = { red: "border-red-600 text-red-600", amber: "border-amber-600 text-amber-600", green: "border-emerald-600 text-emerald-600" };
function Stamp({ v, className }: { v: View; className?: string }) {
  if (!v.stamp) return null;
  return <div className={cx("inline-block -rotate-6 rounded-md border-[3px] px-3 py-0.5 text-lg font-black uppercase tracking-[0.2em] opacity-80", stampTone[v.stamp.tone], className)}>{v.stamp.text}</div>;
}

/** Gross → net, shares, paid and due: the same rows in every A4 / A5 template. */
function totalsRows(b: Bill) {
  return [
    { label: "Gross amount", value: money(b.grossAmount) },
    b.discountAmount > 0 && { label: "Discount", value: `-${money(b.discountAmount)}` },
    b.gstAmount > 0 && { label: "GST", value: money(b.gstAmount) },
    b.roundOff !== 0 && { label: "Round off", value: money(b.roundOff) },
  ].filter(Boolean) as { label: string; value: string }[];
}
function shareRows(b: Bill) {
  return [
    b.payerType !== "Self" && { label: `${b.payerName ?? "Payer"} share`, value: formatMoney(b.payerShare) },
    { label: "Patient share", value: formatMoney(b.patientShare) },
    { label: "Paid by patient", value: formatMoney(b.patientPaid) },
  ].filter(Boolean) as { label: string; value: string }[];
}

/* ======================= Modern ======================= */

function Modern({ v }: { v: View }) {
  const { b, s } = v;
  let n = 0;
  return (
    <article style={v.style} className={cx("bill-doc relative mx-auto overflow-hidden bg-white text-slate-800 shadow-sm ring-1 ring-slate-200 print:max-w-none print:shadow-none print:ring-0", s.paper === "A5" ? "max-w-2xl text-[13px]" : "max-w-4xl text-sm")}>
      <div className="h-2 bg-[var(--accent)]" />
      <header className="flex items-start justify-between gap-6 px-8 pb-5 pt-6 print:px-1">
        <div className="flex min-w-0 items-center gap-4">
          <Logo v={v} />
          <div className="min-w-0">
            <h1 className="text-2xl font-bold leading-tight tracking-tight text-slate-900">{b.hospital.name}</h1>
            {s.headerNote && <p className="mt-0.5 text-xs font-semibold uppercase tracking-wider text-[var(--accent)]">{s.headerNote}</p>}
            {b.hospital.address && <p className="mt-1 text-xs text-slate-500">{b.hospital.address}</p>}
            {v.contact && <p className="text-xs text-slate-500">{v.contact}</p>}
            {b.hospital.gstin && <p className="text-xs text-slate-500">GSTIN: <span className="font-medium text-slate-700">{b.hospital.gstin}</span></p>}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="inline-block rounded-full bg-[var(--accent-soft)] px-3 py-1 text-xs font-bold uppercase tracking-wider text-[var(--accent)]">{v.title}</p>
          <p className="mt-2 font-mono text-lg font-semibold text-slate-900">{b.code}</p>
          <p className="text-xs text-slate-500">{formatDate(b.billDate)}</p>
        </div>
      </header>

      <section className="grid gap-3 px-8 sm:grid-cols-3 print:grid-cols-3 print:px-1">
        <InfoCard label="Billed to">
          <p className="font-semibold text-slate-900">{b.patientName}</p>
          {v.patientMeta && <p className="text-xs text-slate-500">{v.patientMeta}</p>}
        </InfoCard>
        <InfoCard label="Visit">
          <p className="font-medium text-slate-800">{v.visit || "—"}</p>
          {v.stay && <p className="text-xs text-slate-500">{v.stay}</p>}
        </InfoCard>
        <InfoCard label={b.payerType !== "Self" ? "Consultant · payer" : "Consultant"}>
          <p className="font-medium text-slate-800">{b.doctorName ?? "—"}</p>
          <p className="text-xs text-slate-500">{[b.department, v.payer].filter(Boolean).join(" · ") || "Self pay"}</p>
        </InfoCard>
      </section>

      <div className="px-8 pt-5 print:px-1">
        <table className="w-full border-separate border-spacing-0 overflow-hidden rounded-lg">
          <thead>
            <tr className="bg-[var(--accent)] text-left text-[11px] font-semibold uppercase tracking-wider text-white">
              <th className="rounded-l-lg py-2 pl-3 pr-2">#</th>
              <th className="px-2 py-2">Particulars</th>
              <th className="px-2 py-2 text-right">Qty</th>
              <th className="px-2 py-2 text-right">Rate</th>
              <th className="px-2 py-2 text-right">Disc.</th>
              <th className="rounded-r-lg py-2 pl-2 pr-3 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {v.heads.map((h) => (
              <Fragment key={h.head}>
                <tr>
                  <td colSpan={5} className="border-b border-[var(--accent-line)] pb-1 pl-3 pt-3 text-[11px] font-bold uppercase tracking-wider text-[var(--accent)]">{h.head}</td>
                  <td className="border-b border-[var(--accent-line)] pb-1 pr-3 pt-3 text-right text-[11px] font-bold tabular-nums text-[var(--accent)]">{money(h.total)}</td>
                </tr>
                {h.rows.map((l) => (
                  <tr key={l.id} className="break-inside-avoid even:bg-slate-50">
                    <td className="border-b border-slate-100 py-1.5 pl-3 pr-2 align-top text-slate-400">{++n}</td>
                    <td className="border-b border-slate-100 px-2 py-1.5">
                      {l.name}
                      {l.detail && <span className="block text-xs text-slate-500">{l.detail}</span>}
                    </td>
                    <td className="border-b border-slate-100 px-2 py-1.5 text-right tabular-nums">{l.qty}</td>
                    <td className="border-b border-slate-100 px-2 py-1.5 text-right tabular-nums">{money(l.rate)}</td>
                    <td className="border-b border-slate-100 px-2 py-1.5 text-right tabular-nums text-slate-500">{discLabel(l)}</td>
                    <td className="border-b border-slate-100 py-1.5 pl-2 pr-3 text-right font-medium tabular-nums">{money(l.amount)}</td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <section className="grid break-inside-avoid gap-6 px-8 pt-5 sm:grid-cols-[1fr_18rem] print:grid-cols-[1fr_18rem] print:px-1">
        <div className="space-y-3">
          <div className="rounded-lg border border-dashed border-[var(--accent-line)] px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Amount in words</p>
            <p className="font-medium text-slate-800">{amountInWords(b.netAmount)}</p>
          </div>
          {v.gst.length > 0 && <p className="text-xs text-slate-500">GST: {v.gst.map((g) => `${g.rate}% on ${formatMoney(g.taxable)} = ${formatMoney(g.tax)} (CGST ${g.rate / 2}% + SGST ${g.rate / 2}%)`).join("; ")}</p>}
          {b.discountReason && b.discountAmount > 0 && <p className="text-xs text-slate-500">Discount: {b.discountReason}</p>}
          {v.receipts.length > 0 && (
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Payments</p>
              <table className="w-full text-xs">
                <tbody>
                  {v.receipts.map((r) => (
                    <tr key={r.id} className="border-b border-slate-100">
                      <td className="py-1 pr-2 text-slate-500">{formatDateTime(r.at)}</td>
                      <td className="py-1 pr-2 font-mono">{r.code}</td>
                      <td className="py-1 pr-2">{receiptLabel(r, b)} · {receiptModes(r)}</td>
                      <td className={cx("py-1 text-right tabular-nums", r.kind === "Refund" && "text-red-600")}>{r.kind === "Refund" ? "-" : ""}{money(r.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div>
          <dl className="overflow-hidden rounded-xl bg-[var(--accent-soft)] tabular-nums">
            <div className="space-y-1 px-4 pb-2 pt-3">
              {totalsRows(b).map((r) => <div key={r.label} className="flex justify-between"><dt className="text-slate-500">{r.label}</dt><dd>{r.value}</dd></div>)}
            </div>
            <div className="flex items-center justify-between bg-[var(--accent)] px-4 py-2.5 text-white">
              <dt className="text-xs font-semibold uppercase tracking-wider">Net amount</dt>
              <dd className="text-lg font-bold">{formatMoney(b.netAmount)}</dd>
            </div>
            <div className="space-y-1 px-4 py-2 text-xs">
              {shareRows(b).map((r) => <div key={r.label} className="flex justify-between"><dt className="text-slate-500">{r.label}</dt><dd>{r.value}</dd></div>)}
              {b.patientDue > 0 && <div className="flex justify-between text-sm font-bold text-amber-700"><dt>Balance due</dt><dd>{formatMoney(b.patientDue)}</dd></div>}
              {b.refundDue > 0 && <div className="flex justify-between text-sm font-bold text-amber-700"><dt>Refund due</dt><dd>{formatMoney(b.refundDue)}</dd></div>}
            </div>
          </dl>
          {v.stamp && <div className="mt-3 text-right"><Stamp v={v} /></div>}
        </div>
      </section>

      <section className="grid break-inside-avoid items-end gap-6 px-8 pt-8 sm:grid-cols-[1fr_14rem] print:grid-cols-[1fr_14rem] print:px-1">
        <div className="text-xs text-slate-500">
          {v.terms.length > 0 && (
            <>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Terms & conditions</p>
              <ol className="list-decimal space-y-0.5 pl-4">{v.terms.map((t, i) => <li key={i}>{t}</li>)}</ol>
            </>
          )}
          <p className={cx(v.terms.length > 0 && "mt-3")}>Prepared by {b.createdByName ?? "—"}{b.finalizedByName ? ` · finalised by ${b.finalizedByName}` : ""} · {b.paymentStatus}</p>
        </div>
        <div className="text-center">
          <div className="h-12" />
          <p className="border-t border-slate-400 pt-1 text-xs font-medium text-slate-600">{s.signatureLabel}</p>
        </div>
      </section>

      <footer className="mt-6 flex items-center justify-between gap-4 border-t border-[var(--accent-line)] bg-[var(--accent-soft)] px-8 py-2.5 text-[11px] text-slate-500 print:px-1">
        <p className="font-medium text-[var(--accent)]">{v.footer || "Thank you. Wishing you good health."}</p>
        <p className="shrink-0">Computer-generated bill · {b.code}</p>
      </footer>
    </article>
  );
}

function InfoCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border-l-[3px] border-[var(--accent)] bg-[var(--accent-soft)] px-3 py-2">
      <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
      {children}
    </div>
  );
}

/* ======================= Classic ======================= */

function Classic({ v }: { v: View }) {
  const { b, s } = v;
  let n = 0;
  const cell = "border border-slate-400 px-2 py-1";
  return (
    <article style={v.style} className={cx("bill-doc relative mx-auto bg-white p-8 font-serif text-slate-900 shadow-sm ring-1 ring-slate-200 print:max-w-none print:p-0 print:shadow-none print:ring-0", s.paper === "A5" ? "max-w-2xl text-[13px]" : "max-w-4xl text-sm")}>
      <header className="relative flex items-center justify-center gap-4 pb-3">
        <Logo v={v} className="absolute left-0 top-0" />
        <div className={cx("text-center", v.logo && "px-28")}>
          <h1 className="text-2xl font-bold uppercase tracking-wide text-[var(--accent)]">{b.hospital.name}</h1>
          {s.headerNote && <p className="text-xs italic text-slate-600">{s.headerNote}</p>}
          {b.hospital.address && <p className="text-xs text-slate-700">{b.hospital.address}</p>}
          {v.contact && <p className="text-xs text-slate-700">{v.contact}</p>}
          {b.hospital.gstin && <p className="text-xs text-slate-700">GSTIN: {b.hospital.gstin}</p>}
        </div>
      </header>
      <div className="border-y-[3px] border-double border-[var(--accent)] py-1 text-center text-sm font-bold uppercase tracking-[0.25em]">{v.title}</div>

      <table className="mt-3 w-full border-collapse text-[0.92em]">
        <tbody>
          <tr>
            <td className={cx(cell, "w-1/2")}><b>Bill no:</b> <span className="font-mono">{b.code}</span></td>
            <td className={cell}><b>Date:</b> {formatDate(b.billDate)}</td>
          </tr>
          <tr>
            <td className={cell}><b>Patient:</b> {b.patientName}{v.patientMeta ? ` (${v.patientMeta})` : ""}</td>
            <td className={cell}><b>Consultant:</b> {b.doctorName ?? "—"}{b.department ? ` · ${b.department}` : ""}</td>
          </tr>
          <tr>
            <td className={cell}><b>Visit:</b> {v.visit || "—"}</td>
            <td className={cell}>{v.stay || (v.payer ? "" : "—")}{v.stay && v.payer ? " · " : ""}{v.payer}</td>
          </tr>
        </tbody>
      </table>

      <table className="mt-3 w-full border-collapse">
        <thead>
          <tr className="bg-[var(--accent-soft)] text-left text-xs uppercase">
            <th className={cx(cell, "w-8")}>S.No</th><th className={cell}>Particulars</th><th className={cx(cell, "text-right")}>Qty</th><th className={cx(cell, "text-right")}>Rate</th><th className={cx(cell, "text-right")}>Disc.</th><th className={cx(cell, "text-right")}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {v.heads.map((h) => (
            <Fragment key={h.head}>
              <tr><td colSpan={5} className={cx(cell, "font-bold")}>{h.head}</td><td className={cx(cell, "text-right font-bold tabular-nums")}>{money(h.total)}</td></tr>
              {h.rows.map((l) => (
                <tr key={l.id} className="break-inside-avoid">
                  <td className={cx(cell, "text-center")}>{++n}</td>
                  <td className={cell}>{l.name}{l.detail && <span className="block text-xs text-slate-600">{l.detail}</span>}</td>
                  <td className={cx(cell, "text-right tabular-nums")}>{l.qty}</td>
                  <td className={cx(cell, "text-right tabular-nums")}>{money(l.rate)}</td>
                  <td className={cx(cell, "text-right tabular-nums")}>{discLabel(l)}</td>
                  <td className={cx(cell, "text-right tabular-nums")}>{money(l.amount)}</td>
                </tr>
              ))}
            </Fragment>
          ))}
          {totalsRows(b).map((r) => <tr key={r.label}><td colSpan={5} className={cx(cell, "text-right")}>{r.label}</td><td className={cx(cell, "text-right tabular-nums")}>{r.value}</td></tr>)}
          <tr className="bg-[var(--accent-soft)] font-bold"><td colSpan={5} className={cx(cell, "text-right uppercase")}>Net amount</td><td className={cx(cell, "text-right tabular-nums")}>{formatMoney(b.netAmount)}</td></tr>
        </tbody>
      </table>

      <div className="mt-3 grid break-inside-avoid grid-cols-[1fr_16rem] gap-6">
        <div className="space-y-1.5 text-xs">
          <p><b>Rupees:</b> {amountInWords(b.netAmount)}</p>
          {v.gst.length > 0 && <p>GST: {v.gst.map((g) => `${g.rate}% on ${formatMoney(g.taxable)} (CGST + SGST)`).join("; ")}</p>}
          {b.discountReason && b.discountAmount > 0 && <p>Discount: {b.discountReason}</p>}
          {v.receipts.map((r) => <p key={r.id}>{receiptLabel(r, b)} {formatMoney(r.amount)} · {r.code} · {receiptModes(r)} · {formatDateTime(r.at)}</p>)}
        </div>
        <div className="relative">
          <dl className="space-y-0.5 text-xs tabular-nums">
            {shareRows(b).map((r) => <div key={r.label} className="flex justify-between"><dt>{r.label}</dt><dd>{r.value}</dd></div>)}
            {b.patientDue > 0 && <div className="flex justify-between text-sm font-bold"><dt>Balance due</dt><dd>{formatMoney(b.patientDue)}</dd></div>}
            {b.refundDue > 0 && <div className="flex justify-between text-sm font-bold"><dt>Refund due</dt><dd>{formatMoney(b.refundDue)}</dd></div>}
          </dl>
          <Stamp v={v} className="mt-2" />
        </div>
      </div>

      {v.terms.length > 0 && (
        <div className="mt-4 break-inside-avoid text-xs">
          <p className="font-bold underline">Terms & conditions</p>
          <ol className="list-decimal pl-4">{v.terms.map((t, i) => <li key={i}>{t}</li>)}</ol>
        </div>
      )}
      <footer className="mt-12 flex break-inside-avoid items-end justify-between text-xs">
        <p>Prepared by {b.createdByName ?? "—"}{b.finalizedByName ? ` · finalised by ${b.finalizedByName}` : ""}</p>
        <p className="w-52 border-t border-slate-700 pt-1 text-center font-semibold">{s.signatureLabel}</p>
      </footer>
      {v.footer && <p className="mt-4 border-t border-slate-300 pt-2 text-center text-xs italic text-slate-600">{v.footer}</p>}
    </article>
  );
}

/* ======================= Thermal 80 mm ======================= */

function Compact({ v }: { v: View }) {
  const { b, s } = v;
  const dash = "my-1.5 border-t border-dashed border-slate-500";
  const row = "flex justify-between gap-2";
  return (
    <article className="bill-doc mx-auto w-[80mm] max-w-full bg-white p-3 font-mono text-[11px] leading-snug text-black shadow-sm ring-1 ring-slate-200 print:w-auto print:p-0 print:shadow-none print:ring-0">
      <header className="text-center">
        {v.logo && <Logo v={v} className="mx-auto mb-1 !max-h-14 grayscale" />}
        <p className="text-sm font-bold uppercase">{b.hospital.name}</p>
        {s.headerNote && <p>{s.headerNote}</p>}
        {b.hospital.address && <p>{b.hospital.address}</p>}
        {b.hospital.phone && <p>Ph: {b.hospital.phone}</p>}
        {b.hospital.gstin && <p>GSTIN: {b.hospital.gstin}</p>}
      </header>
      <div className={dash} />
      <p className="text-center font-bold uppercase">{v.title}</p>
      <div className={dash} />
      <div className={row}><span>Bill: {b.code}</span><span>{formatDate(b.billDate)}</span></div>
      <p>Patient: {b.patientName}</p>
      {v.patientMeta && <p>{v.patientMeta}</p>}
      {b.doctorName && <p>Dr: {b.doctorName}</p>}
      {v.visit && <p>{v.visit}</p>}
      {v.payer && <p>{v.payer}</p>}
      <div className={dash} />
      {v.lines.map((l) => (
        <div key={l.id} className="mb-0.5">
          <p>{l.name}</p>
          <div className={cx(row, "pl-2")}><span>{l.qty} x {money(l.rate)}{l.discount > 0 ? ` - ${money(l.discount)}` : ""}</span><span>{money(l.amount)}</span></div>
        </div>
      ))}
      <div className={dash} />
      {totalsRows(b).map((r) => <div key={r.label} className={row}><span>{r.label}</span><span>{r.value}</span></div>)}
      <div className={cx(row, "my-1 border-y border-black py-0.5 text-[13px] font-bold")}><span>NET</span><span>{formatMoney(b.netAmount)}</span></div>
      {shareRows(b).map((r) => <div key={r.label} className={row}><span>{r.label}</span><span>{r.value}</span></div>)}
      {b.patientDue > 0 && <div className={cx(row, "font-bold")}><span>Balance due</span><span>{formatMoney(b.patientDue)}</span></div>}
      {b.refundDue > 0 && <div className={cx(row, "font-bold")}><span>Refund due</span><span>{formatMoney(b.refundDue)}</span></div>}
      {v.receipts.length > 0 && <div className={dash} />}
      {v.receipts.map((r) => <div key={r.id} className={row}><span>{r.code} {receiptModes(r)}</span><span>{r.kind === "Refund" ? "-" : ""}{money(r.amount)}</span></div>)}
      <div className={dash} />
      <p className="text-center">{amountInWords(b.netAmount)}</p>
      {v.stamp && <p className="mt-1 text-center font-bold uppercase tracking-widest">** {v.stamp.text} **</p>}
      {v.terms.length > 0 && <div className={dash} />}
      {v.terms.map((t, i) => <p key={i}>{i + 1}. {t}</p>)}
      <div className={dash} />
      <p className="text-center">{v.footer || "Thank you. Get well soon."}</p>
      <p className="text-center text-[10px]">By {b.createdByName ?? "—"} · {b.paymentStatus}</p>
    </article>
  );
}
