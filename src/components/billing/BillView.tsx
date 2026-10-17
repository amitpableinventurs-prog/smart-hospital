"use client";

import { ArrowLeft, Ban, FileCheck2, IndianRupee, Pencil, Plus, Printer, RotateCcw, Trash2, Undo2, Wallet } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { r2 } from "@/lib/billing-math";
import { ApiClientError, api } from "@/lib/client";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { PAYER_TYPES, RATE_PLANS } from "@/lib/modules";
import { useApiQuery } from "@/lib/useApi";
import { Figure, Info } from "../DetailBits";
import { FormModal, numOrUndefined, type ModalField, type ModalValues } from "../FormModal";
import { RefSelect } from "../RecordForm";
import { Alert, Badge, Button, Card, CardHeader, EmptyState, ErrorState, Field, Modal, Spinner, cx, errorRing, inputClass, useToast } from "../ui";
import { ChargePicker, linesPayload, type DraftLine } from "./ChargePicker";
import { ReceiptModal, type ReceiptKind } from "./Receipts";
import { billTone, payTone, type Bill, type BillLine } from "./types";

const corporateRef = { name: "corporate", label: "Corporate / credit party", type: "ref" as const, ref: "billing.corporates", required: true };
const insurerRef = { name: "insuranceProvider", label: "Insurance company", type: "ref" as const, ref: "insurance.providers", refFilter: { payerType: "Insurance Company|Government Scheme" }, required: true };

type Dialog =
  | { kind: "receipt"; receipt: ReceiptKind }
  | { kind: "add" }
  | { kind: "edit-line"; line: BillLine }
  | { kind: "cancel-line"; line: BillLine }
  | { kind: "finalize" | "reopen" | "cancel" | "discount" | "payer" | "paperwork" | "notes" };

/** A hospital bill: charges, receipts and every step from provisional to closed. */
export function BillView({ id }: { id: string }) {
  const toast = useToast();
  const q = useApiQuery<Bill>(`/api/billing/bills/${id}`);
  const [override, setOverride] = useState<Bill | null>(null);
  // Actions return the updated bill, so show it without refetching.
  const b = override?.id === id ? override : q.data;
  const [dialog, setDialog] = useState<Dialog | null>(null);

  if (q.error && !b) return <Card>{q.status === 404 ? <EmptyState title="Bill not found" description={q.error} /> : <ErrorState message={q.error} onRetry={q.reload} />}</Card>;
  if (!b) return <Spinner label="Loading bill…" />;

  const base = `/api/billing/bills/${id}`;
  const done = (bill: Bill, msg: string) => {
    setOverride(bill);
    setDialog(null);
    toast(msg);
  };
  const act = async (body: Record<string, unknown>, msg: string) => {
    const { data } = await api<Bill>(`${base}/action`, { method: "POST", body });
    done(data, msg);
  };
  const patch = async (body: Record<string, unknown>, msg: string) => {
    const { data } = await api<Bill>(base, { method: "PATCH", body });
    done(data, msg);
  };

  const provisional = b.status === "Provisional";
  const live = b.lines.filter((l) => l.status !== "Cancelled");
  const refundable = b.status === "Cancelled" ? b.patientPaid : r2(Math.max(0, b.patientPaid - b.patientShare));
  const hasSettlement = b.receipts.some((r) => r.kind === "Settlement");
  const selfPay = b.payerType === "Self";

  const actions: React.ReactNode[] = [];
  if (provisional) actions.push(<Button key="add" onClick={() => setDialog({ kind: "add" })}><Plus className="size-4" /> Add charges</Button>);
  if (provisional) actions.push(<Button key="adv" variant="secondary" onClick={() => setDialog({ kind: "receipt", receipt: "Advance" })}><Wallet className="size-4" /> Advance</Button>);
  if (b.patientDue > 0 && b.status !== "Cancelled" && b.status !== "Closed") actions.push(<Button key="pay" variant="secondary" onClick={() => setDialog({ kind: "receipt", receipt: "Payment" })}><IndianRupee className="size-4" /> Collect {formatMoney(b.patientDue)}</Button>);
  if (refundable > 0) actions.push(<Button key="rfd" variant="secondary" onClick={() => setDialog({ kind: "receipt", receipt: "Refund" })}><Undo2 className="size-4" /> Refund</Button>);
  if (!selfPay && b.status === "Final" && b.payerDue > 0) actions.push(<Button key="stl" variant="secondary" onClick={() => setDialog({ kind: "receipt", receipt: "Settlement" })}><IndianRupee className="size-4" /> Payer settlement</Button>);
  if (provisional) actions.push(<Button key="fin" onClick={() => setDialog({ kind: "finalize" })}><FileCheck2 className="size-4" /> Finalise</Button>);
  if ((b.status === "Final" || b.status === "Closed") && !hasSettlement) actions.push(<Button key="reo" variant="secondary" onClick={() => setDialog({ kind: "reopen" })}><RotateCcw className="size-4" /> Reopen</Button>);
  if (b.status !== "Cancelled" && !hasSettlement) actions.push(<Button key="can" variant="danger" onClick={() => setDialog({ kind: "cancel" })}><Ban className="size-4" /> Cancel bill</Button>);

  return (
    <>
      <Link href="/m/billing?tab=bills" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 print:hidden"><ArrowLeft className="size-4" /> Back to bills</Link>
      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-mono text-xl font-semibold text-slate-900">{b.code}</h1>
            <Badge tone={billTone(b.status)}>{b.status}</Badge>
            <Badge tone={payTone(b.paymentStatus)}>{b.paymentStatus}</Badge>
            <Badge tone={b.billType === "IPD" ? "violet" : "slate"}>{b.billType}</Badge>
            {!selfPay && <Badge tone="blue">{b.payerType}: {b.payerName}</Badge>}
          </div>
          <p className="mt-1 text-sm text-slate-600">
            <Link href={`/patients/${b.patient}`} className="font-medium text-slate-900 hover:underline">{b.patientName}</Link>
            {" "}{[b.patientCode, b.patientAge != null ? `${b.patientAge} y` : null, b.patientGender, b.patientMobile].filter(Boolean).join(" · ")}
            {" · "}{formatDate(b.billDate)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {actions}
          <Link href={`/billing/bills/${id}/print`}><Button variant="secondary"><Printer className="size-4" /> Print</Button></Link>
        </div>
      </div>

      {b.status === "Cancelled" && <div className="mb-4"><Alert>Cancelled {formatDateTime(b.cancelledAt)} by {b.cancelledByName ?? "—"}: {b.cancelReason}{b.refundDue > 0 ? ` — refund of ${formatMoney(b.refundDue)} is due to the patient.` : ""}</Alert></div>}
      {b.refundDue > 0 && b.status !== "Cancelled" && <div className="mb-4"><Alert tone="amber">The patient has paid {formatMoney(b.refundDue)} more than their share. Refund it to close the bill.</Alert></div>}

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Figure label="Net bill" value={formatMoney(b.netAmount)} hint={b.discountAmount > 0 ? `After ${formatMoney(b.discountAmount)} discount` : `${live.length} charge(s)`} />
        <Figure label="Patient share" value={formatMoney(b.patientShare)} hint={selfPay ? "Self pay" : `${b.payerName} pays ${formatMoney(b.payerShare)}`} />
        <Figure label="Patient paid" value={formatMoney(b.patientPaid)} tone={b.patientPaid > 0 ? "green" : undefined} />
        <Figure label={b.refundDue > 0 ? "Refund due" : provisional && b.patientPaid > b.patientShare ? "Advance balance" : "Patient due"} value={formatMoney(b.refundDue > 0 ? b.refundDue : provisional && b.patientPaid > b.patientShare ? r2(b.patientPaid - b.patientShare) : b.patientDue)} tone={b.refundDue > 0 || b.patientDue > 0 ? "amber" : "green"} />
        <Figure label="Payer due" value={selfPay ? "—" : formatMoney(b.payerDue)} hint={selfPay ? undefined : `Paid ${formatMoney(b.payerPaid)}${b.payerWriteOff ? ` · written off ${formatMoney(b.payerWriteOff)}` : ""}`} tone={b.payerDue > 0 ? "amber" : undefined} />
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Card>
            <CardHeader title="Charges" description={provisional ? "Change or remove charges while the bill is provisional." : "Reopen the bill to change charges."} actions={provisional ? <Button variant="secondary" onClick={() => setDialog({ kind: "discount" })}><Pencil className="size-4" /> Discount</Button> : undefined} />
            {b.lines.length === 0 ? <EmptyState title="No charges yet" description="Add services, packages, doctor fees or manual charges." /> : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-100 text-sm">
                  <thead className="bg-slate-50/60">
                    <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                      <th className="px-4 py-2.5">Charge</th><th className="px-3 py-2.5">Head</th><th className="px-3 py-2.5 text-right">Qty</th><th className="px-3 py-2.5 text-right">Rate</th><th className="px-3 py-2.5 text-right">Disc.</th><th className="px-3 py-2.5 text-right">GST</th><th className="px-3 py-2.5 text-right">Amount</th>{provisional && <th className="px-3 py-2.5" />}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {b.lines.map((l) => {
                      const cancelled = l.status === "Cancelled";
                      return (
                        <tr key={l.id} className={cx(cancelled && "text-slate-400")}>
                          <td className="px-4 py-2.5">
                            <span className={cx(cancelled ? "line-through" : "text-slate-900")}>{l.name}</span>
                            {l.kind !== "Service" && <span className="ml-1"><Badge tone={l.kind === "Inventory" || l.kind === "Ambulance" ? "violet" : "slate"}>{l.kind}</Badge></span>}
                            {l.detail && <span className="block max-w-md truncate text-xs text-slate-500" title={l.detail}>{l.detail}</span>}
                            {cancelled && <span className="block text-xs text-red-600">Removed: {l.cancelReason}{l.cancelledByName ? ` (${l.cancelledByName})` : ""}</span>}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-xs text-slate-600">{l.category}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{l.qty}{l.unit && l.unit !== "Per service" && <span className="block text-xs text-slate-500">{l.unit.replace("Per ", "/")}</span>}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{formatMoney(l.rate)}{l.rateOverridden && <span className="block text-xs text-amber-700">edited</span>}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{l.discount > 0 ? formatMoney(l.discount) : "—"}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{l.gst > 0 ? formatMoney(l.gst) : "—"}</td>
                          <td className="px-3 py-2.5 text-right font-medium tabular-nums">{formatMoney(l.amount)}</td>
                          {provisional && (
                            <td className="whitespace-nowrap px-3 py-2.5 text-right">
                              {!cancelled && l.kind !== "Inventory" && (
                                <>
                                  <button onClick={() => setDialog({ kind: "edit-line", line: l })} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label={`Edit ${l.name}`}><Pencil className="size-4" /></button>
                                  <button onClick={() => setDialog({ kind: "cancel-line", line: l })} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label={`Remove ${l.name}`}><Trash2 className="size-4" /></button>
                                </>
                              )}
                              {!cancelled && l.kind === "Inventory" && <span className="text-xs text-slate-400" title="Return or cancel the stock issue in Inventory">{l.sourceCode}</span>}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <dl className="ml-auto max-w-xs space-y-1 px-5 py-4 text-sm tabular-nums">
              <div className="flex justify-between"><dt className="text-slate-600">Gross</dt><dd>{formatMoney(b.grossAmount)}</dd></div>
              {b.lineDiscount > 0 && <div className="flex justify-between"><dt className="text-slate-600">Line discounts</dt><dd>−{formatMoney(b.lineDiscount)}</dd></div>}
              {b.billDiscount > 0 && <div className="flex justify-between"><dt className="text-slate-600">Bill discount</dt><dd>−{formatMoney(b.billDiscount)}</dd></div>}
              {b.gstAmount > 0 && <div className="flex justify-between"><dt className="text-slate-600">GST</dt><dd>{formatMoney(b.gstAmount)}</dd></div>}
              {b.roundOff !== 0 && <div className="flex justify-between"><dt className="text-slate-600">Round off</dt><dd>{formatMoney(b.roundOff)}</dd></div>}
              <div className="flex justify-between border-t border-slate-200 pt-1 text-base font-semibold"><dt>Net amount</dt><dd>{formatMoney(b.netAmount)}</dd></div>
              {b.discountReason && <p className="pt-1 text-xs text-slate-500">Discount: {b.discountReason}{b.discountApprovedBy ? ` (approved by ${b.discountApprovedBy})` : ""}</p>}
            </dl>
          </Card>

          <Card>
            <CardHeader title="Receipts" description="Advances, payments, refunds and payer settlements" />
            {b.receipts.length === 0 ? <p className="px-5 py-4 text-sm text-slate-500">Nothing received yet.</p> : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-100 text-sm">
                  <thead className="bg-slate-50/60"><tr className="text-left text-xs uppercase tracking-wide text-slate-500"><th className="px-4 py-2.5">Receipt</th><th className="px-3 py-2.5">When</th><th className="px-3 py-2.5">Modes</th><th className="px-3 py-2.5 text-right">Amount</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {b.receipts.map((r) => (
                      <tr key={r.id}>
                        <td className="whitespace-nowrap px-4 py-2.5"><span className="font-mono text-xs">{r.code}</span> <Badge tone={r.kind === "Refund" ? "red" : r.kind === "Settlement" ? "blue" : r.kind === "Advance" ? "violet" : "green"}>{r.kind}</Badge>{r.reason && <span className="block max-w-xs truncate text-xs text-slate-500" title={r.reason}>{r.reason}</span>}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">{formatDateTime(r.at)}<span className="block text-xs text-slate-500">{r.byName}{r.shiftCode ? ` · ${r.shiftCode}` : ""}</span></td>
                        <td className="px-3 py-2.5">
                          {r.splits.length === 0 ? <span className="text-xs text-slate-500">No money received</span> : r.splits.map((s) => (
                            <span key={s.id} className="mr-2 inline-flex items-center gap-1 text-xs text-slate-700">{s.mode} {formatMoney(s.amount)}{s.reference ? ` (${s.reference})` : ""}{s.recon !== "Not Required" && <Badge tone={s.recon === "Bounced" ? "red" : s.recon === "Reconciled" ? "green" : "amber"}>{s.recon}</Badge>}</span>
                          ))}
                          {(r.writeOff ?? 0) > 0 && <span className="block text-xs text-slate-500">Written off {formatMoney(r.writeOff)}</span>}
                          {(r.toPatient ?? 0) > 0 && <span className="block text-xs text-slate-500">Moved to patient {formatMoney(r.toPatient)}</span>}
                        </td>
                        <td className={cx("whitespace-nowrap px-3 py-2.5 text-right font-medium tabular-nums", r.kind === "Refund" && "text-red-600")}>{r.kind === "Refund" ? "−" : ""}{formatMoney(r.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Bill details" actions={!selfPay && b.status === "Final" ? <Button variant="ghost" onClick={() => setDialog({ kind: "paperwork" })}><Pencil className="size-4" /> Payer details</Button> : provisional ? <Button variant="ghost" onClick={() => setDialog({ kind: "payer" })}><Pencil className="size-4" /> Payer</Button> : undefined} />
            <dl className="grid gap-4 p-5 sm:grid-cols-2">
              <Info label="Bill type" value={b.billType} />
              <Info label="Rate plan" value={b.ratePlan} />
              {b.admissionCode && <Info label="Admission" value={`${b.admissionCode}${b.admissionDate ? ` · ${formatDate(b.admissionDate)}` : ""}`} />}
              {b.wardBed && <Info label="Ward / bed" value={b.wardBed} />}
              {b.stayDays != null && <Info label="Stay" value={`${b.stayDays} day(s)${b.dischargeDate ? ` · discharged ${formatDate(b.dischargeDate)}` : ""}`} />}
              {b.visitCode && <Info label="OPD visit" value={b.visitCode} />}
              <Info label="Consultant" value={b.doctorName} />
              <Info label="Department" value={b.department} />
              <Info label="Payer" value={selfPay ? "Self" : `${b.payerName} (${b.payerType})`} />
              {!selfPay && <Info label={b.payerType === "Insurance" ? "Policy no." : "Employee / card no."} value={b.policyNo} />}
              {b.tpaName && <Info label="TPA" value={b.tpaName} />}
              {b.authNo && <Info label="Authorisation" value={b.authNo} />}
              {b.payerLimit != null && <Info label="Approved amount" value={formatMoney(b.payerLimit)} />}
              {b.coveragePct != null && b.payerType === "Corporate" && <Info label="Company pays" value={`${b.coveragePct}%`} />}
              {b.claimCode && <Info label="Insurance claim" value={b.claimCode} />}
              <Info label="Opened by" value={`${b.createdByName ?? "—"} · ${formatDateTime(b.createdAt)}`} wide />
              {b.finalizedAt && <Info label="Finalised" value={`${formatDateTime(b.finalizedAt)} · ${b.finalizedByName ?? ""}`} wide />}
              <div className="sm:col-span-2">
                <dt className="flex items-center justify-between text-xs font-medium uppercase tracking-wide text-slate-500">Notes <button onClick={() => setDialog({ kind: "notes" })} className="normal-case text-brand-700 hover:underline">Edit</button></dt>
                <dd className="mt-1 whitespace-pre-line text-sm text-slate-900">{b.notes || "—"}</dd>
              </div>
            </dl>
          </Card>
          {b.deptDues.length > 0 && (
            <Card>
              <CardHeader title="Other departmental dues" description="Collected in their own modules" />
              <ul className="divide-y divide-slate-100 text-sm">
                {b.deptDues.map((d) => (
                  <li key={d.id} className="flex justify-between gap-2 px-5 py-2.5">
                    <Link href={d.source === "Laboratory" ? `/laboratory/orders/${d.id}` : `/pharmacy/sales/${d.id}`} className="text-brand-700 hover:underline">{d.source} <span className="font-mono text-xs">{d.code}</span></Link>
                    <span className="tabular-nums text-amber-700">{formatMoney(d.balance)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>

      {dialog?.kind === "receipt" && (
        <ReceiptModal
          kind={dialog.receipt}
          max={dialog.receipt === "Refund" ? refundable : dialog.receipt === "Settlement" ? b.payerDue : b.patientDue}
          payerName={b.payerName}
          onClose={() => setDialog(null)}
          onSubmit={(body) => act({ action: "receipt", ...body }, `${dialog.receipt === "Refund" ? "Refund" : dialog.receipt} recorded`)}
        />
      )}
      {dialog?.kind === "add" && <AddChargesModal bill={b} onClose={() => setDialog(null)} onSubmit={(body) => act({ action: "add-lines", ...body }, "Charges added")} />}
      {dialog?.kind === "edit-line" && <EditLineModal bill={b} line={dialog.line} onClose={() => setDialog(null)} onSubmit={(body) => act({ action: "update-line", line: dialog.line.id, ...body }, "Charge updated")} />}
      {dialog?.kind === "cancel-line" && (
        <FormModal title={`Remove ${dialog.line.name}`} description={`${formatMoney(dialog.line.amount)} comes off the bill`} danger confirmLabel="Remove charge" onClose={() => setDialog(null)}
          fields={[{ name: "reason", label: "Reason", type: "textarea", required: true, maxLength: 300 }]}
          onSubmit={(v) => act({ action: "cancel-line", line: dialog.line.id, reason: v.reason }, "Charge removed")} />
      )}
      {dialog?.kind === "finalize" && (
        <FormModal title="Finalise bill" description={`Net ${formatMoney(b.netAmount)} · patient ${formatMoney(b.patientShare)}${selfPay ? "" : ` · ${b.payerName} ${formatMoney(b.payerShare)}`}`} confirmLabel="Finalise" onClose={() => setDialog(null)}
          fields={b.billType === "IPD" && b.admission && !b.dischargeDate ? [{ name: "discharge", label: `Discharge the patient from ${b.admissionCode}`, type: "checkbox", defaultValue: true }] : []}
          onSubmit={(v) => act({ action: "finalize", discharge: v.discharge === true }, "Bill finalised")}>
          {() => (
            <div className="space-y-2 text-sm text-slate-600">
              <p>After finalising, charges and discounts can only be changed by reopening the bill.{b.payerType === "Insurance" ? " An insurance claim is raised automatically." : ""}</p>
              {b.patientPaid > b.patientShare && <Alert tone="amber">The patient has paid {formatMoney(r2(b.patientPaid - b.patientShare))} more than their share; it becomes a refund due.</Alert>}
            </div>
          )}
        </FormModal>
      )}
      {dialog?.kind === "reopen" && (
        <FormModal title="Reopen bill" description="The bill goes back to provisional so charges can be corrected." confirmLabel="Reopen" onClose={() => setDialog(null)}
          fields={[{ name: "reason", label: "Reason", type: "textarea", required: true, maxLength: 300 }]}
          onSubmit={(v) => act({ action: "reopen", reason: v.reason }, "Bill reopened")} />
      )}
      {dialog?.kind === "cancel" && (
        <FormModal title={`Cancel bill ${b.code}`} description={b.patientPaid > 0 ? `${formatMoney(b.patientPaid)} received becomes a refund due.` : "This cannot be undone."} danger confirmLabel="Cancel bill" onClose={() => setDialog(null)}
          fields={[{ name: "reason", label: "Reason", type: "textarea", required: true, maxLength: 300 }]}
          onSubmit={(v) => act({ action: "cancel", reason: v.reason }, "Bill cancelled")} />
      )}
      {dialog?.kind === "discount" && (
        <FormModal title="Bill discount" description={`Gross after line discounts ${formatMoney(r2(b.grossAmount - b.lineDiscount))}`} onClose={() => setDialog(null)}
          fields={[
            { name: "discount", label: "Discount (₹)", type: "number", min: 0, defaultValue: b.billDiscount ? String(b.billDiscount) : "" },
            { name: "discountReason", label: "Reason", type: "textarea", maxLength: 300, defaultValue: b.discountReason ?? "" },
            { name: "discountApprovedBy", label: "Approved by", maxLength: 80, defaultValue: b.discountApprovedBy ?? "" },
          ]}
          onSubmit={(v) => patch({ discount: numOrUndefined(v.discount) ?? 0, discountReason: v.discountReason, discountApprovedBy: v.discountApprovedBy }, "Discount updated")} />
      )}
      {dialog?.kind === "notes" && (
        <FormModal title="Bill notes" onClose={() => setDialog(null)} fields={[{ name: "notes", label: "Notes", type: "textarea", maxLength: 500, defaultValue: b.notes ?? "" }]}
          onSubmit={(v) => patch({ notes: v.notes }, "Notes saved")} />
      )}
      {dialog?.kind === "paperwork" && (
        <FormModal title="Payer details" description={`${b.payerName} · these can change after the bill is final`} size="lg" onClose={() => setDialog(null)}
          fields={[
            { name: "policyNo", label: b.payerType === "Insurance" ? "Policy no." : "Employee / card no.", required: b.payerType === "Insurance", maxLength: 60, defaultValue: b.policyNo ?? "" },
            { name: "authNo", label: "Authorisation no.", maxLength: 60, defaultValue: b.authNo ?? "" },
            { name: "tpaName", label: "TPA", maxLength: 80, defaultValue: b.tpaName ?? "" },
            ...(hasSettlement ? [] : [{ name: "payerLimit", label: "Approved amount (₹)", type: "number", min: 0, defaultValue: b.payerLimit != null ? String(b.payerLimit) : "" } as ModalField]),
          ]}
          onSubmit={(v) => patch({ policyNo: v.policyNo, authNo: v.authNo, tpaName: v.tpaName, ...(hasSettlement ? {} : { payerLimit: v.payerLimit === "" ? "" : Number(v.payerLimit) }) }, "Payer details saved")} />
      )}
      {dialog?.kind === "payer" && <PayerModal bill={b} onClose={() => setDialog(null)} onSubmit={(body) => patch(body, "Payer updated")} />}
    </>
  );
}

function AddChargesModal({ bill, onSubmit, onClose }: { bill: Bill; onSubmit: (body: Record<string, unknown>) => Promise<unknown>; onClose: () => void }) {
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [discountReason, setDiscountReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const needsReason = lines.some((l) => Number(l.discountPct) > 0) && !bill.discountReason;
  async function submit() {
    if (!lines.length) return setError("Add at least one charge");
    if (needsReason && discountReason.trim().length < 3) return setError("Enter the reason for the discount");
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ lines: linesPayload(lines), discountReason: discountReason.trim() || undefined });
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <Modal open size="xl" onClose={onClose} title={`Add charges to ${bill.code}`} description={`${bill.ratePlan} rate plan`}
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Back</Button><Button onClick={submit} loading={busy}>Add {lines.length || ""} charge(s)</Button></>}>
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <ChargePicker lines={lines} onChange={setLines} plan={bill.ratePlan} billType={bill.billType} stayDays={bill.stayDays} />
        {needsReason && (
          <Field label="Discount reason" htmlFor="add-discountReason" required>
            <input id="add-discountReason" maxLength={300} value={discountReason} onChange={(e) => setDiscountReason(e.target.value)} className={inputClass} />
          </Field>
        )}
      </div>
    </Modal>
  );
}

function EditLineModal({ bill, line, onSubmit, onClose }: { bill: Bill; line: BillLine; onSubmit: (body: Record<string, unknown>) => Promise<unknown>; onClose: () => void }) {
  const fields: ModalField[] = [];
  if (line.kind !== "Package") fields.push({ name: "qty", label: "Quantity", type: "number", min: 0.01, required: true, defaultValue: String(line.qty) });
  if (line.rateEditable) fields.push({ name: "rate", label: "Rate", type: "number", min: 0, required: true, defaultValue: String(line.rate) });
  if (line.kind !== "Package") fields.push({ name: "discountPct", label: "Discount %", type: "number", min: 0, max: 100, defaultValue: line.discountPct ? String(line.discountPct) : "" });
  if (!bill.discountReason) fields.push({ name: "discountReason", label: "Discount reason", maxLength: 300, hint: "Needed when giving a discount", wide: true });
  const body = (v: ModalValues) => {
    const out: Record<string, unknown> = {};
    if ("qty" in v && Number(v.qty) !== line.qty) out.qty = Number(v.qty);
    if ("rate" in v && Number(v.rate) !== line.rate) out.rate = Number(v.rate);
    if ("discountPct" in v && (numOrUndefined(v.discountPct) ?? 0) !== (line.discountPct ?? 0)) out.discountPct = numOrUndefined(v.discountPct) ?? 0;
    if (v.discountReason) out.discountReason = v.discountReason;
    return out;
  };
  return <FormModal title={`Edit ${line.name}`} size="lg" onClose={onClose} fields={fields} onSubmit={(v) => onSubmit(body(v))} />;
}

function PayerModal({ bill, onSubmit, onClose }: { bill: Bill; onSubmit: (body: Record<string, unknown>) => Promise<unknown>; onClose: () => void }) {
  const [payerType, setPayerType] = useState<string>(bill.payerType);
  const [v, setV] = useState({
    corporate: bill.corporate ?? "", insuranceProvider: bill.insuranceProvider ?? "", policyNo: bill.policyNo ?? "", tpaName: bill.tpaName ?? "", authNo: bill.authNo ?? "",
    payerLimit: bill.payerLimit != null ? String(bill.payerLimit) : "", ratePlan: bill.payerType === "Self" ? bill.ratePlan : "General",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof v, val: string) => setV((s) => ({ ...s, [k]: val }));
  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ payerType, ...v });
    } catch (e) {
      if (e instanceof ApiClientError && e.fields) setErrors(e.fields);
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <Modal open onClose={onClose} title="Change payer" description="Service charges are re-priced for the payer's rate plan"
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Back</Button><Button onClick={submit} loading={busy}>Save payer</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        {error && <div className="sm:col-span-2"><Alert>{error}</Alert></div>}
        <Field label="Bill to" htmlFor="py-type" required>
          <select id="py-type" value={payerType} onChange={(e) => setPayerType(e.target.value)} className={inputClass}>
            {PAYER_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </Field>
        {payerType === "Self" ? (
          <Field label="Rate plan" htmlFor="py-plan" required error={errors.ratePlan}>
            <select id="py-plan" value={v.ratePlan} onChange={(e) => set("ratePlan", e.target.value)} className={inputClass}>
              {RATE_PLANS.filter((p) => p !== "Corporate" && p !== "Insurance").map((p) => <option key={p}>{p}</option>)}
            </select>
          </Field>
        ) : payerType === "Corporate" ? (
          <Field label="Corporate / credit party" htmlFor="py-corporate" required error={errors.corporate}>
            <RefSelect id="py-corporate" field={corporateRef} value={v.corporate} initial={bill.corporate ? { id: bill.corporate, label: bill.payerName ?? "" } : undefined} className={cx(inputClass, errorRing(errors.corporate))} onChange={(x) => set("corporate", x)} />
          </Field>
        ) : (
          <Field label="Insurance company" htmlFor="py-insurer" required error={errors.insuranceProvider}>
            <RefSelect id="py-insurer" field={insurerRef} value={v.insuranceProvider} initial={bill.insuranceProvider ? { id: bill.insuranceProvider, label: bill.payerName ?? "" } : undefined} className={cx(inputClass, errorRing(errors.insuranceProvider))} onChange={(x) => set("insuranceProvider", x)} />
          </Field>
        )}
        {payerType !== "Self" && (
          <>
            <Field label={payerType === "Insurance" ? "Policy / card no." : "Employee / card no."} htmlFor="py-policy" required={payerType === "Insurance"} error={errors.policyNo}>
              <input id="py-policy" maxLength={60} value={v.policyNo} onChange={(e) => set("policyNo", e.target.value)} className={cx(inputClass, errorRing(errors.policyNo))} />
            </Field>
            {payerType === "Insurance" && (
              <Field label="TPA" htmlFor="py-tpa"><input id="py-tpa" maxLength={80} value={v.tpaName} onChange={(e) => set("tpaName", e.target.value)} className={inputClass} /></Field>
            )}
            <Field label="Authorisation no." htmlFor="py-auth"><input id="py-auth" maxLength={60} value={v.authNo} onChange={(e) => set("authNo", e.target.value)} className={inputClass} /></Field>
            <Field label="Approved amount (₹)" htmlFor="py-limit" error={errors.payerLimit}>
              <input id="py-limit" type="number" min={0} step="any" value={v.payerLimit} onChange={(e) => set("payerLimit", e.target.value)} className={cx(inputClass, errorRing(errors.payerLimit))} />
            </Field>
          </>
        )}
      </div>
    </Modal>
  );
}
