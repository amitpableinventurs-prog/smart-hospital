"use client";

import { ArrowLeft, Ban, Check, ClipboardCheck, PackageCheck, Printer, Save, Tag, Truck, Undo2, Unlock, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { amountInWords } from "@/lib/billing-math";
import { ApiClientError, api } from "@/lib/client";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { DOC_CONFIG, isDocType, type DocType } from "@/lib/inventory-docs";
import { useApiQuery } from "@/lib/useApi";
import { Alert, Badge, Button, Card, EmptyState, ErrorState, Field, Kbd, Modal, Spinner, cx, inputClass, statusTone, useHotkeys, useToast } from "../ui";
import type { StockDocument } from "./types";

const TITLES: Partial<Record<DocType, string>> = {
  po: "Purchase Order", grn: "Goods Receipt Note", requisition: "Purchase Requisition", transfer: "Stock Transfer Note", issue: "Department Issue Slip",
  patient_issue: "Patient Issue Slip", return: "Stock Return Note", purchase_return: "Debit Note / Purchase Return", write_off: "Stock Write-off", adjustment: "Stock Adjustment",
  verification: "Physical Verification Sheet", reservation: "Stock Reservation", opening: "Stock Entry",
};

export function DocView({ id }: { id: string }) {
  const toast = useToast();
  const q = useApiQuery<StockDocument>(`/api/inventory/docs/${id}`);
  const [latest, setLatest] = useState<StockDocument | null>(null);
  const d = latest?.id === id ? latest : q.data;
  const [dialog, setDialog] = useState<null | { action: "reject" | "cancel" | "close"; title: string }>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, string>>({});
  useHotkeys({ "ctrl+p": () => window.print() }, !dialog);

  if (q.error) return <Card>{q.status === 404 ? <EmptyState title="Document not found" /> : <ErrorState message={q.error} onRetry={q.reload} />}</Card>;
  if (!d) return <Spinner label="Loading…" />;
  const type = (isDocType(d.type) ? d.type : "grn") as DocType;
  const cfg = DOC_CONFIG[type];

  async function act(action: string, extra: Record<string, unknown> = {}, msg = "Done") {
    setBusy(action);
    try {
      const { data } = await api<StockDocument>(`/api/inventory/docs/${id}/action`, { method: "POST", body: { action, ...extra } });
      setLatest(data);
      setDialog(null);
      toast(msg);
      return true;
    } catch (e) {
      if (action === "post" && e instanceof ApiClientError && e.fields?.counts === "uncounted") {
        if (window.confirm(`${e.message}\n\nPost now and treat uncounted lines as matching?`)) return act("post", { confirmUncounted: true }, msg);
        return false;
      }
      toast(e instanceof ApiClientError && e.fields ? Object.values(e.fields)[0] : (e as Error).message, "error");
      return false;
    } finally {
      setBusy(null);
    }
  }
  const saveCounts = () => act("count", { counts: Object.entries(counts).map(([line, counted]) => ({ line, counted })) }, "Counts saved");

  const s = d.status;
  const newDoc = (t: DocType, param: string) => `/inventory/docs/new?type=${t}&${param}=${d.id}`;
  const actions = (
    <div className="flex flex-wrap gap-2 print:hidden">
      {(type === "po" || type === "requisition") && s === "Pending Approval" && (
        <>
          <Button loading={busy === "approve"} onClick={() => act("approve", {}, "Approved")}><Check className="size-4" /> Approve</Button>
          <Button variant="secondary" className="text-red-600" onClick={() => setDialog({ action: "reject", title: `Reject ${d.code}?` })}><X className="size-4" /> Reject</Button>
        </>
      )}
      {type === "requisition" && s === "Approved" && <Link href={newDoc("po", "requisition")}><Button><Truck className="size-4" /> Create purchase order</Button></Link>}
      {type === "po" && (s === "Approved" || s === "Partially Received") && <Link href={newDoc("grn", "po")}><Button><PackageCheck className="size-4" /> Receive goods (GRN)</Button></Link>}
      {((type === "po" && (s === "Approved" || s === "Partially Received")) || (type === "requisition" && (s === "Approved" || s === "Ordered"))) && (
        <Button variant="secondary" onClick={() => setDialog({ action: "close", title: `Close ${d.code}?` })}>Close</Button>
      )}
      {type === "grn" && s === "Posted" && <Link href={newDoc("purchase_return", "against")}><Button variant="secondary"><Undo2 className="size-4" /> Return to supplier</Button></Link>}
      {type === "grn" && s === "Posted" && <Link href={`/inventory/barcodes?doc=${d.id}`} target="_blank"><Button variant="secondary"><Tag className="size-4" /> Batch labels</Button></Link>}
      {(type === "issue" || type === "patient_issue" || type === "transfer") && s === "Posted" && <Link href={newDoc("return", "against")}><Button variant="secondary"><Undo2 className="size-4" /> Return stock</Button></Link>}
      {type === "reservation" && s === "Active" && (
        <>
          <Link href={newDoc(d.patient ? "patient_issue" : "issue", "reservation")}><Button><PackageCheck className="size-4" /> Issue reserved stock</Button></Link>
          <Button variant="secondary" loading={busy === "release"} onClick={() => act("release", {}, "Reservation released")}><Unlock className="size-4" /> Release</Button>
        </>
      )}
      {type === "verification" && s === "Counting" && (
        <>
          <Button variant="secondary" loading={busy === "count"} onClick={saveCounts}><Save className="size-4" /> Save counts</Button>
          <Button loading={busy === "post"} onClick={async () => { if (Object.keys(counts).length) await saveCounts(); act("post", {}, "Verification posted"); }}><ClipboardCheck className="size-4" /> Post differences</Button>
        </>
      )}
      {((["Posted"].includes(s) && type !== "verification") || (type === "po" && ["Pending Approval", "Approved"].includes(s)) || (type === "requisition" && ["Approved"].includes(s)) || (type === "verification" && s === "Counting")) && (
        <Button variant="secondary" className="text-red-600" onClick={() => setDialog({ action: "cancel", title: `Cancel ${d.code}?` })}><Ban className="size-4" /> Cancel</Button>
      )}
      <Button variant="secondary" onClick={() => window.print()}><Printer className="size-4" /> Print <Kbd>Ctrl+P</Kbd></Button>
    </div>
  );

  const money = type === "po" || type === "grn" || type === "purchase_return";
  return (
    <>
      <Link href={`/m/inventory?tab=${type}`} className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 print:hidden"><ArrowLeft className="size-4" /> Back to {cfg.label.toLowerCase()}</Link>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold text-slate-900">{cfg.singular} <span className="font-mono">{d.code}</span></h1>
          <Badge tone={statusTone(s)}>{s}</Badge>
          {d.priority === "Urgent" && <Badge tone="amber">Urgent</Badge>}
        </div>
        {actions}
      </div>
      {d.cancelReason && <div className="mb-4 print:hidden"><Alert tone="amber">{s === "Closed" ? "Closed" : s === "Rejected" ? "Rejected" : "Cancelled"} by {d.cancelledByName ?? "—"} {d.cancelledAt ? formatDateTime(d.cancelledAt) : ""}: {d.cancelReason}</Alert></div>}

      <Card className="mx-auto max-w-5xl p-8 print:max-w-none print:border-0 print:p-0 print:shadow-none">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-slate-800 pb-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900">{d.org.name}</h2>
            {d.org.address && <p className="text-xs text-slate-600">{d.org.address}</p>}
            <p className="text-xs text-slate-600">{[d.org.phone && `Ph: ${d.org.phone}`, d.org.gstin && `GSTIN: ${d.org.gstin}`].filter(Boolean).join(" · ")}</p>
          </div>
          <div className="text-right">
            <p className="text-sm font-bold uppercase tracking-wide">{TITLES[type]}</p>
            <p className="font-mono text-sm">{d.code}</p>
            <p className="text-xs text-slate-600">Date: {formatDate(d.docDate)}</p>
            {s === "Cancelled" && <p className="text-xs font-bold uppercase text-red-600">Cancelled</p>}
          </div>
        </header>

        <section className="grid gap-x-6 gap-y-1.5 border-b border-slate-200 py-3 text-sm sm:grid-cols-2">
          {d.supplierInfo && <Meta label={type === "purchase_return" ? "Returned to" : "Supplier"} value={[d.supplierInfo.name, d.supplierInfo.gstin && `GSTIN ${d.supplierInfo.gstin}`, d.supplierInfo.phone].filter(Boolean).join(" · ")} />}
          {d.storeName && <Meta label={cfg.store?.label ?? "Store"} value={d.storeName} />}
          {d.toStoreName && <Meta label={type === "return" ? "Returned from" : "To store"} value={d.toStoreName} />}
          {d.department && <Meta label="Department" value={d.department} />}
          {d.patientName && <Meta label="Patient" value={`${d.patientName}${d.patientCode ? ` (${d.patientCode})` : ""}`} />}
          {d.purpose && <Meta label="Reserved for" value={d.purpose} />}
          {d.invoiceNo && <Meta label="Supplier invoice" value={`${d.invoiceNo} · ${formatDate(d.invoiceDate)}`} />}
          {d.dueDate && <Meta label="Payment due" value={formatDate(d.dueDate)} />}
          {d.poCode && <Meta label="Purchase order" value={d.poCode} link={`/inventory/docs/${d.po}`} />}
          {d.requisitionCode && <Meta label="Requisition" value={d.requisitionCode} link={`/inventory/docs/${d.requisition}`} />}
          {d.againstCode && <Meta label="Against" value={d.againstCode} link={`/inventory/docs/${d.against}`} />}
          {d.reservationCode && <Meta label="Reservation" value={d.reservationCode} link={`/inventory/docs/${d.reservation}`} />}
          {d.reason && <Meta label="Reason" value={d.reason} />}
          {d.requiredBy && <Meta label="Required by" value={formatDate(d.requiredBy)} />}
          {d.expectedDate && <Meta label="Expected delivery" value={formatDate(d.expectedDate)} />}
          {d.billingInvoiceCode && <Meta label="Patient bill" value={d.billingInvoiceCode} />}
        </section>

        <LinesTable d={d} type={type} counts={counts} setCounts={setCounts} />

        <div className="mt-4 grid gap-6 sm:grid-cols-2 print:grid-cols-2">
          <div className="space-y-1 text-xs text-slate-600">
            {money && d.netAmount > 0 && <p className="font-medium text-slate-800">{amountInWords(d.netAmount)}</p>}
            {d.terms && <p>Terms: {d.terms}</p>}
            {d.notes && <p>Notes: {d.notes}</p>}
            {d.payments.length > 0 && (
              <div className="pt-2">
                <p className="font-semibold text-slate-700">Payments</p>
                {d.payments.map((p) => <p key={p.code}>{p.code} · {formatDate(p.date)} · {p.mode}{p.reference ? ` (${p.reference})` : ""} · {formatMoney(p.amount)}</p>)}
              </div>
            )}
            {d.linked.length > 0 && (
              <div className="pt-2 print:hidden">
                <p className="font-semibold text-slate-700">Linked documents</p>
                {d.linked.map((l) => <p key={l.id}><Link href={`/inventory/docs/${l.id}`} className="font-mono text-brand-700 hover:underline">{l.code}</Link> · {DOC_CONFIG[l.type as DocType]?.singular} · {formatDate(l.docDate)} · {l.status}</p>)}
              </div>
            )}
          </div>
          <dl className="space-y-1 text-sm tabular-nums">
            {money ? (
              <>
                <Row label="Taxable" value={formatMoney(d.taxableTotal)} />
                <Row label="GST" value={formatMoney(d.gstTotal)} />
                {d.roundOff !== 0 && <Row label="Round off" value={d.roundOff.toFixed(2)} />}
                <div className="flex justify-between border-t-2 border-slate-800 pt-1 text-base font-bold"><dt>{type === "purchase_return" ? "Debit note value" : "Net amount"}</dt><dd>{formatMoney(d.netAmount)}</dd></div>
              </>
            ) : type === "patient_issue" || type === "return" ? (
              <div className="flex justify-between border-t-2 border-slate-800 pt-1 text-base font-bold"><dt>{type === "return" ? "Value returned" : "Value at MRP"}</dt><dd>{formatMoney(d.netAmount)}</dd></div>
            ) : d.costValue ? (
              <div className="flex justify-between border-t-2 border-slate-800 pt-1 text-base font-bold"><dt>{type === "verification" ? "Net variance (cost)" : "Value at cost"}</dt><dd>{formatMoney(d.costValue)}</dd></div>
            ) : null}
          </dl>
        </div>

        <footer className="mt-10 grid grid-cols-3 gap-4 border-t border-slate-200 pt-3 text-xs text-slate-500">
          <p>Prepared by {d.createdByName ?? "—"}<br />{formatDateTime(d.createdAt)}</p>
          <p className="text-center">{d.approvedByName ? <>Approved by {d.approvedByName}<br />{formatDateTime(d.approvedAt)}</> : type === "transfer" || type === "issue" || type === "patient_issue" ? "Received by" : ""}</p>
          <p className="text-right">Authorised signatory</p>
        </footer>
      </Card>

      {dialog && <ReasonModal title={dialog.title} required={dialog.action !== "close"} onClose={() => setDialog(null)} busy={busy === dialog.action}
        note={dialog.action === "cancel" && !["po", "requisition", "verification"].includes(type) ? "All stock movements of this document will be reversed." : undefined}
        onSubmit={(reason) => act(dialog.action, { reason }, dialog.action === "cancel" ? "Cancelled" : dialog.action === "close" ? "Closed" : "Rejected")} />}
    </>
  );
}

function LinesTable({ d, type, counts, setCounts }: { d: StockDocument; type: DocType; counts: Record<string, string>; setCounts: (f: (c: Record<string, string>) => Record<string, string>) => void }) {
  const kind = DOC_CONFIG[type].lineKind;
  const purchase = DOC_CONFIG[type].purchaseUnits;
  const counting = type === "verification" && d.status === "Counting";
  const cols =
    type === "po" ? ["#", "Item", "Qty", "Received", "Rate", "Disc %", "GST %", "Amount"]
    : type === "grn" ? ["#", "Item", "Batch", "Expiry", "Qty", "Free", "Rate", "MRP", "GST %", "Amount", "Returned"]
    : type === "purchase_return" ? ["#", "Item", "Batch", "Qty", "Rate", "GST %", "Amount"]
    : type === "requisition" || type === "reservation" ? ["#", "Item", "Quantity", "Remarks"]
    : type === "verification" ? ["#", "Item", "Batch", "Expiry", "System", "Counted", "Difference", "Value"]
    : ["#", "Item", "Batch", "Expiry", "Qty", ...(type === "patient_issue" ? ["MRP", "Amount"] : ["Rate", "Value"]), ...(kind === "pick" ? ["Returned"] : [])];
  const r = "text-right tabular-nums";
  return (
    <table className="mt-3 w-full text-xs">
      <thead><tr className="border-b border-slate-300 text-left uppercase text-slate-500">{cols.map((c, i) => <th key={i} className={cx("py-1.5 pr-2", i > 1 && !["Batch", "Expiry", "Remarks"].includes(c) && "text-right")}>{c}</th>)}</tr></thead>
      <tbody>
        {d.lines.map((l, i) => {
          const unit = purchase ? l.purchaseUnit || l.unit : l.unit;
          const name = <td className="py-1.5 pr-2"><span className="font-medium text-slate-900">{l.itemName}</span> <span className="text-slate-500">{l.sku}</span>{l.remarks && kind !== "request" ? <span className="block text-slate-500">{l.remarks}</span> : null}</td>;
          const exp = <td className="py-1.5 pr-2">{l.expiryDate ? new Date(l.expiryDate).toLocaleDateString("en-IN", { month: "2-digit", year: "numeric", timeZone: "UTC" }) : "—"}</td>;
          const qty = (n: number) => <td className={cx("py-1.5 pr-2", r)}>{n} {unit}</td>;
          const n = <td className="py-1.5 pr-2 text-slate-500">{i + 1}</td>;
          if (type === "po") return <tr key={l.id} className="border-b border-slate-100">{n}{name}{qty(l.qty)}<td className={cx("py-1.5 pr-2", r)}>{l.receivedQty ?? 0}</td><td className={cx("py-1.5 pr-2", r)}>{l.rate.toFixed(2)}</td><td className={cx("py-1.5 pr-2", r)}>{l.discountPct || ""}</td><td className={cx("py-1.5 pr-2", r)}>{l.gstRate}</td><td className={cx("py-1.5", r)}>{(l.amount ?? 0).toFixed(2)}</td></tr>;
          if (type === "grn") return <tr key={l.id} className="border-b border-slate-100">{n}{name}<td className="py-1.5 pr-2 font-mono">{l.batchNo}</td>{exp}{qty(l.qty)}<td className={cx("py-1.5 pr-2", r)}>{l.freeQty || ""}</td><td className={cx("py-1.5 pr-2", r)}>{l.rate.toFixed(2)}</td><td className={cx("py-1.5 pr-2", r)}>{l.mrp?.toFixed(2) ?? ""}</td><td className={cx("py-1.5 pr-2", r)}>{l.gstRate}</td><td className={cx("py-1.5 pr-2", r)}>{(l.amount ?? 0).toFixed(2)}</td><td className={cx("py-1.5", r)}>{l.returnedQty || ""}</td></tr>;
          if (type === "purchase_return") return <tr key={l.id} className="border-b border-slate-100">{n}{name}<td className="py-1.5 pr-2 font-mono">{l.batchNo}</td>{qty(l.qty)}<td className={cx("py-1.5 pr-2", r)}>{l.rate.toFixed(2)}</td><td className={cx("py-1.5 pr-2", r)}>{l.gstRate}</td><td className={cx("py-1.5", r)}>{(l.amount ?? 0).toFixed(2)}</td></tr>;
          if (type === "requisition" || type === "reservation") return <tr key={l.id} className="border-b border-slate-100">{n}{name}{qty(l.qty)}<td className="py-1.5">{l.remarks ?? ""}</td></tr>;
          if (type === "verification") {
            const counted = counts[l.id] ?? (l.countedQty != null ? String(l.countedQty) : "");
            const diff = counted === "" ? null : +(Number(counted) - (l.systemQty ?? 0)).toFixed(2);
            const shown = counting ? diff : l.qty;
            return (
              <tr key={l.id} className="border-b border-slate-100">{n}{name}<td className="py-1.5 pr-2 font-mono">{l.batchNo}</td>{exp}<td className={cx("py-1.5 pr-2", r)}>{l.systemQty}</td>
                <td className={cx("py-1.5 pr-2", r)}>
                  {counting ? <input value={counted} inputMode="decimal" onChange={(e) => setCounts((c) => ({ ...c, [l.id]: e.target.value.replace(/[^0-9.]/g, "") }))} className="w-20 rounded border-0 px-1.5 py-0.5 text-right ring-1 ring-inset ring-slate-300 print:ring-0" aria-label={`Counted ${l.itemName} ${l.batchNo}`} /> : (l.countedQty ?? "—")}
                </td>
                <td className={cx("py-1.5 pr-2", r, shown ? (shown < 0 ? "font-semibold text-red-600" : "font-semibold text-emerald-700") : "")}>{shown == null ? "" : shown > 0 ? `+${shown}` : shown}</td>
                <td className={cx("py-1.5", r)}>{shown ? (shown * l.rate).toFixed(2) : ""}</td>
              </tr>
            );
          }
          const value = type === "patient_issue" ? (l.mrp ?? 0) : l.rate;
          return (
            <tr key={l.id} className="border-b border-slate-100">{n}{name}<td className="py-1.5 pr-2 font-mono">{l.batchNo}</td>{exp}{qty(l.qty)}
              <td className={cx("py-1.5 pr-2", r)}>{value.toFixed(2)}</td><td className={cx("py-1.5 pr-2", r)}>{(Math.abs(l.qty) * value).toFixed(2)}</td>
              {kind === "pick" && <td className={cx("py-1.5", r)}>{l.returnedQty || ""}</td>}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Meta({ label, value, link }: { label: string; value: string; link?: string }) {
  return (
    <div className="flex gap-2">
      <span className="w-36 shrink-0 text-slate-500">{label}</span>
      {link ? <Link href={link} className="font-medium text-brand-700 hover:underline print:text-slate-900">{value}</Link> : <span className="font-medium text-slate-900">{value}</span>}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between text-slate-600"><dt>{label}</dt><dd>{value}</dd></div>;
}

function ReasonModal({ title, note, required, busy, onClose, onSubmit }: { title: string; note?: string; required: boolean; busy: boolean; onClose: () => void; onSubmit: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  return (
    <Modal open onClose={onClose} size="md" title={title} description={note}
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Back</Button><Button variant="danger" loading={busy} disabled={required && reason.trim().length < 3} onClick={() => onSubmit(reason)}>Confirm</Button></>}>
      <Field label="Reason" htmlFor="doc-reason" required={required} hint="Recorded in the activity log.">
        <input id="doc-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} className={inputClass} />
      </Field>
    </Modal>
  );
}
