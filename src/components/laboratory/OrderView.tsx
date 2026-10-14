"use client";

import { AlertTriangle, ArrowLeft, Ban, CheckCheck, ClipboardCheck, Copy, FileText, IndianRupee, Link2, Mail, MessageCircle, PackageCheck, Pencil, Play, Receipt, RotateCcw, Send, Share2, ShieldCheck, Syringe, Tag, Truck, Undo2 } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { ApiClientError, api } from "@/lib/client";
import { formatDateTime, formatMoney } from "@/lib/format";
import { PAYMENT_MODES } from "@/lib/modules";
import { useApiQuery } from "@/lib/useApi";
import { CancelModal } from "../pharmacy/CancelModal";
import { PayOnlineButton } from "../payments/Razorpay";
import { RefSelect, type RefOption } from "../RecordForm";
import { Alert, Badge, Button, Card, CardHeader, EmptyState, ErrorState, Field, Modal, Spinner, cx, inputClass, statusTone, useToast } from "../ui";
import { RejectSampleModal } from "./LabSection";
import { Barcode, FLAG_LABEL, FlagBadge, rangeLabel, type LabItem, type LabOrder, type LabSample, type ResultRow } from "./shared";

const PATHOLOGIST_KEY = "lab:lastPathologist";
const outsourceRef = { name: "lab", label: "Outsourced lab", type: "ref" as const, ref: "laboratory.outsource_labs", required: true };
const pathologistRef = { name: "pathologist", label: "Pathologist", type: "ref" as const, ref: "doctors.doctors", required: true };

type Dialog =
  | { kind: "cancel-order" }
  | { kind: "cancel-item" | "reopen"; item: LabItem }
  | { kind: "approve" | "sendout"; item: LabItem }
  | { kind: "reject"; sample: LabSample }
  | { kind: "pay" | "refund" }
  | { kind: "share" };

export function OrderView({ id }: { id: string }) {
  const toast = useToast();
  const q = useApiQuery<LabOrder>(`/api/laboratory/orders/${id}`);
  const [latest, setLatest] = useState<LabOrder | null>(null);
  // Actions return the updated order; show it until the next reload.
  const order = latest?.id === id ? latest : q.data;
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const back = (
    <Link href="/m/laboratory?tab=orders" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 print:hidden">
      <ArrowLeft className="size-4" /> Back to lab orders
    </Link>
  );
  if (q.error) return <>{back}<Card>{q.status === 404 ? <EmptyState title="Lab order not found" /> : <ErrorState message={q.error} onRetry={q.reload} />}</Card></>;
  if (!order) return <>{back}<Spinner label="Loading lab order…" /></>;

  const updated = (o: LabOrder, msg: string) => {
    setLatest(o);
    setDialog(null);
    toast(msg);
  };
  async function post(key: string, url: string, body: Record<string, unknown>, msg: string) {
    setBusy(key);
    try {
      const { data } = await api<LabOrder>(url, { method: "POST", body });
      updated(data, msg);
      return true;
    } catch (e) {
      toast((e as Error).message, "error");
      return false;
    } finally {
      setBusy(null);
    }
  }
  const base = `/api/laboratory/orders/${order.id}`;
  const itemAct = (item: LabItem, action: string, msg: string, extra: Record<string, unknown> = {}) => post(`${item.id}:${action}`, `${base}/items/${item.id}`, { action, ...extra }, msg);
  const sampleAct = (s: LabSample, action: string, msg: string) => post(`${s.id}:${action}`, `${base}/samples/${s.id}`, { action }, msg);

  const live = order.items.filter((i) => i.status !== "Cancelled");
  const approvedCount = live.filter((i) => i.status === "Approved").length;
  const balance = Math.max(0, (order.netAmount ?? 0) - (order.paidAmount ?? 0));
  const refundDue = Math.max(0, (order.paidAmount ?? 0) - (order.netAmount ?? 0));
  const cancelled = order.status === "Cancelled";

  return (
    <>
      {back}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-slate-900">Lab order <span className="font-mono">{order.code}</span></h1>
            <Badge tone={statusTone(order.status)}>{order.status}</Badge>
            <Badge tone={statusTone(order.paymentStatus ?? "")}>{order.paymentStatus}</Badge>
            {order.priority !== "Routine" && <Badge tone={order.priority === "STAT" ? "red" : "amber"}>{order.priority}</Badge>}
          </div>
          <p className="mt-1 text-sm text-slate-500">Registered {formatDateTime(order.orderDate)} by {order.createdByName ?? "—"} · {approvedCount}/{live.length} tests reported</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {approvedCount > 0 && <Link href={`/laboratory/orders/${order.id}/report`} target="_blank"><Button><FileText className="size-4" /> Report / PDF</Button></Link>}
          {approvedCount > 0 && <Button variant="secondary" onClick={() => setDialog({ kind: "share" })}><Share2 className="size-4" /> Share</Button>}
          <Link href={`/laboratory/orders/${order.id}/labels`} target="_blank"><Button variant="secondary"><Tag className="size-4" /> Labels</Button></Link>
          <Link href={`/laboratory/orders/${order.id}/bill`} target="_blank"><Button variant="secondary"><Receipt className="size-4" /> Bill</Button></Link>
          {!cancelled && approvedCount === 0 && <Button variant="secondary" className="text-red-600" onClick={() => setDialog({ kind: "cancel-order" })}><Ban className="size-4" /> Cancel order</Button>}
        </div>
      </div>

      {cancelled && <div className="mb-4"><Alert tone="amber">Order cancelled. Reason: {order.cancelReason ?? "—"}{refundDue > 0 ? ` · Refund of ${formatMoney(refundDue)} is due.` : ""}</Alert></div>}
      {live.some((i) => i.critical) && (
        <div className="mb-4"><Alert>Critical values on {live.filter((i) => i.critical).map((i) => i.testName).join(", ")} — inform the referring doctor immediately.</Alert></div>
      )}

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Card>
            <CardHeader title="Samples" description="Each sample has its own accession number and barcode." />
            <div className="divide-y divide-slate-100">
              {order.samples.map((s) => {
                const tests = order.items.filter((i) => i.sampleNo === s.accessionNo && i.status !== "Cancelled");
                return (
                  <div key={s.id} className={cx("flex flex-wrap items-center gap-4 px-5 py-3", s.status === "Rejected" && "bg-red-50/40")}>
                    <div className="w-36">
                      <Barcode value={s.accessionNo} height={28} className="h-7 w-full" />
                      <p className="mt-0.5 text-center font-mono text-[11px] text-slate-700">{s.accessionNo}</p>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-900">{s.sampleType} <span className="font-normal text-slate-500">· {s.container}</span></p>
                      <p className="truncate text-xs text-slate-500">{tests.map((t) => t.testCode || t.testName).join(", ") || (s.replacedBy ? `Replaced by ${s.replacedBy}` : "—")}</p>
                      <p className="text-[11px] text-slate-500">
                        {s.status === "Rejected" ? `Rejected: ${s.rejectReason}` : [s.collectedAt && `Collected ${formatDateTime(s.collectedAt)} by ${s.collectedByName}`, s.receivedAt && `Received ${formatDateTime(s.receivedAt)}`].filter(Boolean).join(" · ") || (s.recollectOf ? `Recollection of ${s.recollectOf}` : "Awaiting collection")}
                      </p>
                    </div>
                    <Badge tone={statusTone(s.status)}>{s.status}</Badge>
                    {!cancelled && (
                      <div className="flex gap-1.5">
                        {s.status === "Pending" && tests.length > 0 && <Button variant="secondary" loading={busy === `${s.id}:collect`} onClick={() => sampleAct(s, "collect", `Sample ${s.accessionNo} collected`)}><Syringe className="size-4" /> Collect</Button>}
                        {s.status === "Collected" && <Button variant="secondary" loading={busy === `${s.id}:receive`} onClick={() => sampleAct(s, "receive", `Sample ${s.accessionNo} received`)}><PackageCheck className="size-4" /> Receive</Button>}
                        {(s.status === "Collected" || s.status === "Received") && <button onClick={() => setDialog({ kind: "reject", sample: s })} className="rounded p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600" title="Reject sample"><Ban className="size-4" /></button>}
                        <Link href={`/laboratory/orders/${order.id}/labels?sample=${s.id}`} target="_blank" className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-brand-700" title="Print label"><Tag className="size-4" /></Link>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>

          <Card>
            <CardHeader title="Tests & results" description="Processing → result entry → technician verification → pathologist approval." />
            <div className="divide-y divide-slate-100">
              {order.items.map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  template={order.templates?.[item.id]}
                  editing={editing === item.id}
                  busy={busy}
                  disabled={cancelled}
                  onEdit={(on) => setEditing(on ? item.id : null)}
                  onAct={(action, msg, extra) => itemAct(item, action, msg, extra)}
                  onDialog={(kind) => setDialog({ kind, item } as Dialog)}
                  onSaved={(o) => { setEditing(null); updated(o, `Results saved for ${item.testName}`); }}
                  base={base}
                />
              ))}
            </div>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Patient & request" actions={order.patient ? <Link href={`/patients/${order.patient}`} className="text-xs font-medium text-brand-700 hover:underline">Patient record</Link> : undefined} />
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 p-5 text-sm">
              <Info label="Patient" value={order.patientName} wide />
              <Info label="Patient ID" value={order.patientCode ?? "—"} mono />
              <Info label="Age / sex" value={[order.patientAge != null ? `${order.patientAge} yrs` : null, order.patientGender].filter(Boolean).join(" / ") || "—"} />
              <Info label="Mobile" value={order.patientMobile ?? "—"} />
              <Info label="Request" value={[order.source, order.visitCode, order.admissionCode].filter(Boolean).join(" · ")} />
              {order.wardBed && <Info label="Ward / bed" value={order.wardBed} />}
              <Info label="Referred by" value={order.doctorName ?? "Self"} />
              <Info label="Rate plan" value={order.ratePlan ?? "General"} />
              {order.clinicalNotes && <Info label="Clinical notes" value={order.clinicalNotes} wide />}
            </dl>
          </Card>

          <Card>
            <CardHeader title="Billing" actions={<Link href={`/laboratory/orders/${order.id}/bill`} target="_blank" className="text-xs font-medium text-brand-700 hover:underline">Print bill</Link>} />
            <div className="space-y-3 p-5 text-sm">
              <ul className="space-y-1">
                {order.items.map((i) => (
                  <li key={i.id} className={cx("flex justify-between gap-3", i.status === "Cancelled" && "text-slate-400 line-through")}>
                    <span className="truncate">{i.testName}{i.profileName ? <span className="text-xs text-slate-400"> · {i.profileName}</span> : null}</span>
                    <span className="tabular-nums">{i.price.toFixed(2)}</span>
                  </li>
                ))}
              </ul>
              <dl className="space-y-1 border-t border-slate-200 pt-2 tabular-nums">
                <Row label="Gross" value={formatMoney(order.grossAmount)} />
                {(order.discount ?? 0) > 0 && <Row label="Discount" value={`- ${formatMoney(order.discount)}`} />}
                <Row label="Net" value={formatMoney(order.netAmount)} strong />
                <Row label="Received" value={formatMoney(order.paidAmount)} />
                {balance > 0 && <Row label="Balance due" value={formatMoney(balance)} tone="text-amber-700" strong />}
                {refundDue > 0 && <Row label="Refund due" value={formatMoney(refundDue)} tone="text-red-600" strong />}
              </dl>
              {(order.payments?.length ?? 0) > 0 && (
                <ul className="space-y-1 border-t border-slate-100 pt-2 text-xs text-slate-600">
                  {order.payments!.map((p, i) => (
                    <li key={i} className="flex justify-between gap-2">
                      <span>{p.kind === "Refund" ? "Refund" : "Paid"} · {p.mode}{p.reference ? ` (${p.reference})` : ""} · {formatDateTime(p.at)}</span>
                      <span className={cx("tabular-nums", p.kind === "Refund" && "text-red-600")}>{p.kind === "Refund" ? "-" : ""}{p.amount.toFixed(2)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex gap-2">
                {!cancelled && balance > 0 && <Button className="flex-1" onClick={() => setDialog({ kind: "pay" })}><IndianRupee className="size-4" /> Collect payment</Button>}
                {!cancelled && <PayOnlineButton kind="lab_order" id={order.id} due={balance} className="flex-1" onPaid={() => api<LabOrder>(base).then(({ data }) => updated(data, "Online payment received and recorded"), () => q.reload())} />}
                {refundDue > 0 && <Button variant="secondary" className="flex-1 text-red-600" onClick={() => setDialog({ kind: "refund" })}><Undo2 className="size-4" /> Record refund</Button>}
              </div>
            </div>
          </Card>

          {(order.shares?.length ?? 0) > 0 && (
            <Card>
              <CardHeader title="Report sharing" description={order.shareToken ? `Link active until ${formatDateTime(order.shareExpiresAt)}` : "No active link"} />
              <ul className="space-y-1 p-5 text-xs text-slate-600">
                {order.shares!.map((s, i) => <li key={i}>{s.to} via {s.channel}{s.recipient ? ` (${s.recipient})` : ""} · {formatDateTime(s.at)} · {s.byName}</li>)}
              </ul>
            </Card>
          )}
        </div>
      </div>

      {dialog?.kind === "cancel-order" && (
        <CancelModal url={`${base}/cancel`} label={`order ${order.code}`} note="All pending tests will be cancelled. Any payment received becomes a refund due." onClose={() => setDialog(null)} onDone={(o) => updated(o as LabOrder, "Order cancelled")} />
      )}
      {dialog?.kind === "cancel-item" && (
        <ReasonModal title={`Cancel ${dialog.item.testName}?`} note={`${formatMoney(dialog.item.price)} will be removed from the bill.`} confirm="Cancel test" danger
          onClose={() => setDialog(null)} onSubmit={(reason) => itemAct(dialog.item, "cancel", `${dialog.item.testName} cancelled`, { reason })} />
      )}
      {dialog?.kind === "reopen" && (
        <ReasonModal title={`Reopen ${dialog.item.testName}?`} note="The result goes back to entry; it must be verified and approved again. The reason is kept in the activity log." confirm="Reopen for correction"
          onClose={() => setDialog(null)} onSubmit={(reason) => itemAct(dialog.item, "reopen", `${dialog.item.testName} reopened`, { reason })} />
      )}
      {dialog?.kind === "approve" && <ApproveModal item={dialog.item} onClose={() => setDialog(null)} onSubmit={(pathologist) => itemAct(dialog.item, "approve", `${dialog.item.testName} approved`, { pathologist })} />}
      {dialog?.kind === "sendout" && <SendOutModal item={dialog.item} onClose={() => setDialog(null)} onSubmit={(lab, reference) => itemAct(dialog.item, "sendout", `${dialog.item.testName} sent out`, { lab, reference })} />}
      {dialog?.kind === "reject" && (
        <RejectSampleModal url={`${base}/samples/${dialog.sample.id}`} accessionNo={dialog.sample.accessionNo} onClose={() => setDialog(null)} onDone={(o) => updated(o as LabOrder, "Sample rejected — recollection requested")} />
      )}
      {(dialog?.kind === "pay" || dialog?.kind === "refund") && (
        <PaymentModal kind={dialog.kind === "pay" ? "Payment" : "Refund"} max={dialog.kind === "pay" ? balance : refundDue} url={`${base}/payments`} onClose={() => setDialog(null)} onDone={(o) => updated(o, dialog.kind === "pay" ? "Payment recorded" : "Refund recorded")} />
      )}
      {dialog?.kind === "share" && <ShareModal order={order} url={`${base}/share`} onClose={() => setDialog(null)} onChanged={() => { setDialog(null); setLatest(null); q.reload(); }} />}
    </>
  );
}

/* ---------- one test ---------- */

function ItemRow({ item, template, editing, busy, disabled, onEdit, onAct, onDialog, onSaved, base }: {
  item: LabItem; template?: ResultRow[]; editing: boolean; busy: string | null; disabled: boolean; base: string;
  onEdit: (on: boolean) => void; onAct: (action: string, msg: string, extra?: Record<string, unknown>) => void;
  onDialog: (kind: "cancel-item" | "reopen" | "approve" | "sendout") => void; onSaved: (o: LabOrder) => void;
}) {
  const s = item.status;
  const canEnter = ["Sample Received", "In Process", "Sent Out", "Result Entered", "Verified"].includes(s);
  const b = (action: string) => busy === `${item.id}:${action}`;
  return (
    <div className={cx("px-5 py-4", s === "Cancelled" && "opacity-60")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-slate-900">
            {item.testName} <span className="font-mono text-xs text-slate-500">{item.testCode}</span>
            {item.critical && <span className="ml-2 inline-flex items-center gap-0.5 text-xs font-semibold text-red-600"><AlertTriangle className="size-3.5" /> Critical</span>}
            {!item.critical && item.abnormal && <span className="ml-2 text-xs font-semibold text-amber-700">Abnormal</span>}
          </p>
          <p className="text-xs text-slate-500">
            {[item.categoryName, item.profileName && `Profile: ${item.profileName}`, item.sampleNo && `Sample ${item.sampleNo}`, item.outsourceLabName && (item.sentOutAt ? `Sent to ${item.outsourceLabName}${item.outsourceRef ? ` (${item.outsourceRef})` : ""}` : `Default lab: ${item.outsourceLabName}`)].filter(Boolean).join(" · ")}
          </p>
          <p className="text-[11px] text-slate-400">
            {[item.enteredByName && `Entered by ${item.enteredByName}`, item.verifiedByName && `verified by ${item.verifiedByName}`, item.approvedByName && `approved by ${item.approvedByName} (${item.pathologistName})`, item.cancelReason && `Cancelled: ${item.cancelReason}`].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={statusTone(s)}>{s}</Badge>
          {!disabled && !editing && (
            <>
              {s === "Sample Received" && <Button variant="secondary" loading={b("process")} onClick={() => onAct("process", `Processing ${item.testName}`)}><Play className="size-4" /> Process</Button>}
              {(s === "Sample Received" || s === "In Process") && <Button variant="secondary" onClick={() => onDialog("sendout")}><Truck className="size-4" /> Send out</Button>}
              {canEnter && <Button variant={s === "Result Entered" || s === "Verified" ? "secondary" : "primary"} onClick={() => onEdit(true)}><Pencil className="size-4" /> {item.results.length || item.reportText ? "Edit results" : "Enter results"}</Button>}
              {s === "Result Entered" && <Button loading={b("verify")} onClick={() => onAct("verify", `${item.testName} verified`)}><ClipboardCheck className="size-4" /> Verify</Button>}
              {s === "Verified" && <Button onClick={() => onDialog("approve")}><ShieldCheck className="size-4" /> Approve</Button>}
              {(s === "Approved" || s === "Verified") && <button onClick={() => onDialog("reopen")} className="rounded p-1.5 text-slate-500 hover:bg-slate-100" title="Reopen for correction"><RotateCcw className="size-4" /></button>}
              {s !== "Approved" && s !== "Cancelled" && <button onClick={() => onDialog("cancel-item")} className="rounded p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600" title="Cancel test"><Ban className="size-4" /></button>}
            </>
          )}
        </div>
      </div>

      {editing ? (
        <ResultEntry item={item} rows={item.results.length ? item.results : (template ?? [])} url={`${base}/items/${item.id}`} onCancel={() => onEdit(false)} onSaved={onSaved} />
      ) : item.reportType === "Descriptive" && item.reportText ? (
        <p className="mt-3 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm text-slate-800">{item.reportText}</p>
      ) : item.results.length > 0 ? (
        <ResultTable rows={item.results} />
      ) : null}
      {!editing && item.remarks && <p className="mt-2 text-xs text-slate-600">Remarks: {item.remarks}</p>}
    </div>
  );
}

function ResultTable({ rows }: { rows: ResultRow[] }) {
  return (
    <div className="mt-3 overflow-x-auto rounded-lg ring-1 ring-slate-200">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr><th className="px-3 py-1.5 text-left">Parameter</th><th className="px-3 py-1.5 text-left">Result</th><th className="px-3 py-1.5 text-left">Unit</th><th className="px-3 py-1.5 text-left">Reference range</th></tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="px-3 py-1.5 text-slate-700">{r.name}</td>
              <td className={cx("px-3 py-1.5 tabular-nums", r.flag ? "font-bold text-red-700" : "text-slate-900")}>{r.value ?? "—"} <FlagBadge flag={r.flag} /></td>
              <td className="px-3 py-1.5 text-slate-500">{r.unit ?? ""}</td>
              <td className="px-3 py-1.5 text-slate-500">{rangeLabel(r)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Same flag rules as the server, for instant feedback while typing. */
function liveFlag(r: ResultRow, value: string) {
  if (!value) return "";
  if (r.resultType === "Numeric") {
    const n = Number(value);
    if (!Number.isFinite(n)) return "";
    if (r.criticalLow != null && n < r.criticalLow) return "LL";
    if (r.criticalHigh != null && n > r.criticalHigh) return "HH";
    if (r.low != null && n < r.low) return "L";
    if (r.high != null && n > r.high) return "H";
    return "";
  }
  return r.normalValue && value.toLowerCase() !== r.normalValue.toLowerCase() ? "A" : "";
}

function ResultEntry({ item, rows, url, onCancel, onSaved }: { item: LabItem; rows: ResultRow[]; url: string; onCancel: () => void; onSaved: (o: LabOrder) => void }) {
  const keyOf = (r: ResultRow) => r.parameter ?? r.name;
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(rows.map((r) => [keyOf(r), r.value ?? ""])));
  const [reportText, setReportText] = useState(item.reportText ?? "");
  const [remarks, setRemarks] = useState(item.remarks ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const descriptive = item.reportType === "Descriptive";

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const { data } = await api<LabOrder>(url, { method: "POST", body: { action: "results", results: rows.map((r) => ({ key: keyOf(r), value: values[keyOf(r)] ?? "" })), reportText, remarks } });
      onSaved(data);
    } catch (err) {
      if (err instanceof ApiClientError && err.fields) setErrors(err.fields);
      setError((err as Error).message);
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="mt-3 space-y-3 rounded-lg bg-slate-50 p-4 ring-1 ring-slate-200">
      {error && <Alert>{error}</Alert>}
      {item.status === "Verified" && <Alert tone="amber">Editing a verified result sends it back for verification.</Alert>}
      {descriptive ? (
        <Field label="Report" htmlFor={`rt-${item.id}`} required error={errors.reportText}>
          <textarea id={`rt-${item.id}`} rows={8} value={reportText} onChange={(e) => setReportText(e.target.value)} maxLength={10000} className={inputClass} placeholder="Gross description, microscopy, impression…" />
        </Field>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-xs uppercase tracking-wide text-slate-500">
              <tr><th className="py-1 pr-3 text-left">Parameter</th><th className="py-1 pr-3 text-left">Result</th><th className="py-1 pr-3 text-left">Unit</th><th className="py-1 text-left">Reference</th></tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => {
                const k = keyOf(r);
                const v = values[k] ?? "";
                const flag = liveFlag(r, v);
                const err = errors[`results.${idx}`];
                const common = { id: `res-${item.id}-${idx}`, value: v, "aria-invalid": !!err, className: cx(inputClass, "py-1.5", flag && "font-bold text-red-700", err && "ring-red-400") };
                const onChange = (x: string) => setValues((s) => ({ ...s, [k]: x }));
                return (
                  <tr key={k} className="align-top">
                    <td className="py-1 pr-3"><label htmlFor={common.id} className="text-slate-700">{r.name}</label></td>
                    <td className="w-48 py-1 pr-3">
                      <div className="flex items-center gap-1.5">
                        {r.resultType === "Options" && r.options ? (
                          <select {...common} onChange={(e) => onChange(e.target.value)}>
                            <option value="">Select…</option>
                            {r.options.split(",").map((o) => <option key={o.trim()}>{o.trim()}</option>)}
                          </select>
                        ) : (
                          <input {...common} inputMode={r.resultType === "Numeric" ? "decimal" : undefined} autoComplete="off" onChange={(e) => onChange(e.target.value)} autoFocus={idx === 0} />
                        )}
                        <FlagBadge flag={flag} />
                      </div>
                      {err && <p className="mt-0.5 text-xs text-red-600">{err}</p>}
                    </td>
                    <td className="py-1 pr-3 text-slate-500">{r.unit ?? ""}</td>
                    <td className="py-1 text-slate-500">{rangeLabel(r)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-1 text-[11px] text-slate-500">Flags: {Object.entries(FLAG_LABEL).map(([k, v]) => `${k} = ${v}`).join(" · ")}</p>
        </div>
      )}
      <Field label="Remarks / interpretation" htmlFor={`rm-${item.id}`}>
        <input id={`rm-${item.id}`} value={remarks} onChange={(e) => setRemarks(e.target.value)} maxLength={1000} className={inputClass} />
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={saving}>Cancel</Button>
        <Button type="submit" loading={saving}><CheckCheck className="size-4" /> Save results</Button>
      </div>
    </form>
  );
}

/* ---------- dialogs ---------- */

function useSubmit() {
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown> | unknown) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };
  return [busy, run] as const;
}

function ReasonModal({ title, note, confirm, danger, onClose, onSubmit }: { title: string; note: string; confirm: string; danger?: boolean; onClose: () => void; onSubmit: (reason: string) => unknown }) {
  const [reason, setReason] = useState("");
  const [busy, run] = useSubmit();
  return (
    <Modal open onClose={onClose} size="md" title={title} description={note}
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Back</Button><Button variant={danger ? "danger" : "primary"} loading={busy} disabled={reason.trim().length < 3} onClick={() => run(() => onSubmit(reason))}>{confirm}</Button></>}>
      <Field label="Reason" htmlFor="reason" required hint="Recorded in the activity log.">
        <input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} className={inputClass} />
      </Field>
    </Modal>
  );
}

function readLastPathologist(): RefOption | undefined {
  try {
    const raw = localStorage.getItem(PATHOLOGIST_KEY);
    return raw ? (JSON.parse(raw) as RefOption) : undefined;
  } catch {
    return undefined;
  }
}

function ApproveModal({ item, onClose, onSubmit }: { item: LabItem; onClose: () => void; onSubmit: (pathologist: string) => unknown }) {
  const [initial] = useState(readLastPathologist);
  const [doc, setDoc] = useState<RefOption | undefined>(initial);
  const [busy, run] = useSubmit();
  return (
    <Modal open onClose={onClose} size="md" title={`Approve ${item.testName}`} description={`Verified by ${item.verifiedByName ?? "—"}. Approval must be done by a different user and releases the result on the report.`}
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Back</Button><Button loading={busy} disabled={!doc} onClick={() => run(() => {
        try { localStorage.setItem(PATHOLOGIST_KEY, JSON.stringify(doc)); } catch { /* storage unavailable */ }
        return onSubmit(doc!.id);
      })}><ShieldCheck className="size-4" /> Approve & release</Button></>}>
      <Field label="Approving pathologist" htmlFor="pathologist" required hint="Printed with signature details on the report. Pathologists are maintained in the Doctors module.">
        <RefSelect id="pathologist" field={pathologistRef} value={doc?.id ?? ""} initial={initial} className={inputClass} onChange={() => {}} onPick={(o) => setDoc(o ?? undefined)} />
      </Field>
    </Modal>
  );
}

function SendOutModal({ item, onClose, onSubmit }: { item: LabItem; onClose: () => void; onSubmit: (lab: string, reference: string) => unknown }) {
  const initial = item.outsourceLab ? { id: item.outsourceLab, label: item.outsourceLabName ?? "Default lab" } : undefined;
  const [lab, setLab] = useState(initial?.id ?? "");
  const [reference, setReference] = useState("");
  const [busy, run] = useSubmit();
  return (
    <Modal open onClose={onClose} size="md" title={`Send ${item.testName} to an outside lab`} description="Enter the results here when the outside lab reports back."
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Back</Button><Button loading={busy} disabled={!lab} onClick={() => run(() => onSubmit(lab, reference))}><Send className="size-4" /> Mark sent</Button></>}>
      <div className="space-y-4">
        <Field label="Outsourced lab" htmlFor="olab" required>
          <RefSelect id="olab" field={outsourceRef} value={lab} initial={initial} className={inputClass} onChange={setLab} />
        </Field>
        <Field label="Their reference / docket no." htmlFor="oref">
          <input id="oref" value={reference} maxLength={60} onChange={(e) => setReference(e.target.value)} className={inputClass} />
        </Field>
      </div>
    </Modal>
  );
}

function PaymentModal({ kind, max, url, onClose, onDone }: { kind: "Payment" | "Refund"; max: number; url: string; onClose: () => void; onDone: (o: LabOrder) => void }) {
  const [amount, setAmount] = useState(String(max));
  const [mode, setMode] = useState("Cash");
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, run] = useSubmit();
  const submit = () => run(async () => {
    setError(null);
    try {
      const { data } = await api<LabOrder>(url, { method: "POST", body: { kind, amount: Number(amount), mode, reference } });
      onDone(data);
    } catch (e) {
      setError(e instanceof ApiClientError && e.fields ? Object.values(e.fields)[0] : (e as Error).message);
    }
  });
  return (
    <Modal open onClose={onClose} size="md" title={kind === "Refund" ? "Record refund" : "Collect payment"} description={`${kind === "Refund" ? "Refund due" : "Balance due"}: ${formatMoney(max)}`}
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Back</Button><Button loading={busy} onClick={submit}>{kind === "Refund" ? "Record refund" : "Record payment"}</Button></>}>
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <Field label="Amount" htmlFor="pay-amount" required>
          <input id="pay-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} className={inputClass} />
        </Field>
        <Field label="Mode" htmlFor="pay-mode" required>
          <select id="pay-mode" value={mode} onChange={(e) => setMode(e.target.value)} className={inputClass}>
            {PAYMENT_MODES.filter((m) => m !== "Credit").map((m) => <option key={m}>{m}</option>)}
          </select>
        </Field>
        <Field label="Reference" htmlFor="pay-ref">
          <input id="pay-ref" value={reference} maxLength={60} onChange={(e) => setReference(e.target.value)} className={inputClass} />
        </Field>
      </div>
    </Modal>
  );
}

function ShareModal({ order, url, onClose, onChanged }: { order: LabOrder; url: string; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [to, setTo] = useState<"Patient" | "Doctor">("Patient");
  const [channel, setChannel] = useState<"WhatsApp" | "Email" | "SMS" | "Link">("WhatsApp");
  const defaults = { Patient: { WhatsApp: order.patientMobile, SMS: order.patientMobile, Email: "", Link: "" }, Doctor: { WhatsApp: order.doctorPhone, SMS: order.doctorPhone, Email: order.doctorEmail, Link: "" } };
  const [recipient, setRecipient] = useState(defaults.Patient.WhatsApp ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, run] = useSubmit();
  const pick = (t: typeof to, c: typeof channel) => {
    setTo(t);
    setChannel(c);
    setRecipient(defaults[t][c] ?? "");
  };

  const submit = () => run(async () => {
    setError(null);
    // Open the target window synchronously so pop-up blockers allow it.
    const win = channel === "WhatsApp" ? window.open("about:blank", "_blank") : null;
    try {
      const { data } = await api<{ token: string; expiresAt: string }>(url, { method: "POST", body: { to, channel, recipient } });
      const link = `${window.location.origin}/lab-report/${data.token}`;
      const message = `${order.lab.name}: lab report ${order.code} for ${order.patientName} is ready. View/download: ${link}`;
      const digits = recipient.replace(/[^0-9]/g, "");
      if (channel === "WhatsApp" && win) win.location.href = `https://wa.me/${digits.length === 10 ? `91${digits}` : digits}?text=${encodeURIComponent(message)}`;
      else if (channel === "Email") window.location.href = `mailto:${recipient}?subject=${encodeURIComponent(`Lab report ${order.code}`)}&body=${encodeURIComponent(message)}`;
      else if (channel === "SMS") window.location.href = `sms:${recipient}?body=${encodeURIComponent(message)}`;
      else await navigator.clipboard?.writeText(link).catch(() => {});
      toast(channel === "Link" ? "Report link copied" : `Report shared via ${channel}`);
      onChanged();
    } catch (e) {
      win?.close();
      setError(e instanceof ApiClientError && e.fields ? Object.values(e.fields)[0] : (e as Error).message);
    }
  });
  async function revoke() {
    try {
      await api(url, { method: "DELETE" });
      toast("Share link revoked");
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const icons: Record<string, ReactNode> = { WhatsApp: <MessageCircle className="size-4" />, Email: <Mail className="size-4" />, SMS: <MessageCircle className="size-4" />, Link: <Link2 className="size-4" /> };
  return (
    <Modal open onClose={onClose} size="md" title="Share lab report" description={`A secure link (valid 30 days, approved results only) is sent${order.shareToken ? "; the existing link is reused" : ""}.`}
      footer={<>
        {order.shareToken && <Button variant="ghost" className="mr-auto text-red-600" onClick={revoke}>Revoke link</Button>}
        <Button variant="secondary" onClick={onClose} disabled={busy}>Close</Button>
        <Button loading={busy} onClick={submit}>{channel === "Link" ? <Copy className="size-4" /> : icons[channel]} {channel === "Link" ? "Copy link" : `Share via ${channel}`}</Button>
      </>}>
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <Field label="Share with" htmlFor="share-to">
          <div id="share-to" className="flex gap-1 rounded-lg bg-slate-100 p-1">
            {(["Patient", "Doctor"] as const).map((t) => (
              <button key={t} type="button" onClick={() => pick(t, channel)} className={cx("flex-1 rounded-md px-3 py-1.5 text-sm font-medium", to === t ? "bg-white text-brand-700 shadow-sm" : "text-slate-600")}>
                {t === "Doctor" ? `Doctor${order.doctorName ? ` (${order.doctorName})` : ""}` : `Patient (${order.patientName})`}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Channel" htmlFor="share-ch">
          <div id="share-ch" className="grid grid-cols-4 gap-1 rounded-lg bg-slate-100 p-1">
            {(["WhatsApp", "SMS", "Email", "Link"] as const).map((c) => (
              <button key={c} type="button" onClick={() => pick(to, c)} className={cx("inline-flex items-center justify-center gap-1 rounded-md px-2 py-1.5 text-sm font-medium", channel === c ? "bg-white text-brand-700 shadow-sm" : "text-slate-600")}>{icons[c]} {c}</button>
            ))}
          </div>
        </Field>
        {channel !== "Link" && (
          <Field label={channel === "Email" ? "Email address" : "Mobile number"} htmlFor="share-rcpt" required>
            <input id="share-rcpt" value={recipient} onChange={(e) => setRecipient(e.target.value)} type={channel === "Email" ? "email" : "tel"} className={inputClass} />
          </Field>
        )}
      </div>
    </Modal>
  );
}

function Info({ label, value, wide, mono }: { label: string; value: string; wide?: boolean; mono?: boolean }) {
  return (
    <div className={wide ? "col-span-2" : undefined}>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={cx("mt-0.5 whitespace-pre-line text-slate-900", mono && "font-mono text-xs")}>{value}</dd>
    </div>
  );
}

function Row({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: string }) {
  return <div className={cx("flex justify-between", strong && "font-semibold", tone ?? "text-slate-700")}><dt>{label}</dt><dd>{value}</dd></div>;
}

