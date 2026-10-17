"use client";

import { Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { r2 } from "@/lib/billing-math";
import { ApiClientError } from "@/lib/client";
import { formatMoney } from "@/lib/format";
import { BILL_PAYMENT_MODES } from "@/lib/modules";
import { useApiQuery } from "@/lib/useApi";
import { Alert, Button, Field, Modal, cx, errorRing, inputClass } from "../ui";
import type { Shift } from "./types";

export interface SplitDraft {
  mode: string;
  amount: string;
  reference: string;
}

export const emptySplit = (amount = ""): SplitDraft => ({ mode: "Cash", amount, reference: "" });
export const splitsPayload = (splits: SplitDraft[]) => splits.filter((s) => Number(s.amount) > 0).map((s) => ({ mode: s.mode, amount: Number(s.amount), reference: s.reference.trim() || undefined }));
export const splitsTotal = (splits: SplitDraft[]) => r2(splits.reduce((s, x) => s + (Number(x.amount) || 0), 0));

/** One receipt can be paid across several modes (e.g. part cash, part UPI). */
export function SplitsEditor({ splits, onChange, errors = {}, disabled }: { splits: SplitDraft[]; onChange: (s: SplitDraft[]) => void; errors?: Record<string, string>; disabled?: boolean }) {
  const set = (i: number, patch: Partial<SplitDraft>) => onChange(splits.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  return (
    <div className="space-y-2">
      {splits.map((s, i) => {
        const err = errors[`splits.${i}`];
        const needsRef = s.mode !== "Cash";
        return (
          <div key={i}>
            <div className="grid grid-cols-[8.5rem_1fr_1fr_auto] gap-2">
              <select value={s.mode} disabled={disabled} onChange={(e) => set(i, { mode: e.target.value })} className={inputClass} aria-label="Payment mode">
                {BILL_PAYMENT_MODES.map((m) => <option key={m}>{m}</option>)}
              </select>
              <input type="number" min={0} step="any" inputMode="decimal" value={s.amount} disabled={disabled} onChange={(e) => set(i, { amount: e.target.value })} placeholder="Amount" className={cx(inputClass, errorRing(err))} aria-label={`${s.mode} amount`} />
              <input value={s.reference} disabled={disabled || !needsRef} maxLength={60} onChange={(e) => set(i, { reference: e.target.value })} placeholder={s.mode === "Cheque" ? "Cheque no." : s.mode === "Bank Transfer" ? "UTR no." : needsRef ? "Txn / approval ref." : "—"} className={inputClass} aria-label="Reference" />
              <button type="button" disabled={disabled || splits.length === 1} onClick={() => onChange(splits.filter((_, j) => j !== i))} className="rounded p-2 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30" aria-label="Remove mode"><Trash2 className="size-4" /></button>
            </div>
            {err && <p className="mt-1 text-xs text-red-600">{err}</p>}
          </div>
        );
      })}
      {splits.length < 5 && (
        <button type="button" disabled={disabled} onClick={() => onChange([...splits, { mode: "UPI", amount: "", reference: "" }])} className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">
          <Plus className="size-3.5" /> Split across another mode
        </button>
      )}
      {errors.splits && <p className="text-xs text-red-600">{errors.splits}</p>}
    </div>
  );
}

/** Warns when the cashier has no open shift (receipts other than payer settlements need one). */
export function ShiftNotice() {
  const q = useApiQuery<Shift | null>("/api/billing/shifts/current");
  if (q.loading || q.error || q.data) return null;
  return (
    <Alert tone="amber">
      Your cash counter shift is not open. <Link href="/m/billing?tab=counter" className="font-medium underline">Open a shift</Link> to take receipts.
    </Alert>
  );
}

export type ReceiptKind = "Advance" | "Payment" | "Refund" | "Settlement";

const TITLE: Record<ReceiptKind, string> = { Advance: "Collect advance", Payment: "Collect payment", Refund: "Refund to patient", Settlement: "Record payer settlement" };

/** Advance / payment / refund at the counter, or a corporate / insurer settlement. */
export function ReceiptModal({ kind, max, payerName, onSubmit, onClose }: { kind: ReceiptKind; max: number; payerName?: string; onSubmit: (body: Record<string, unknown>) => Promise<unknown>; onClose: () => void }) {
  const [splits, setSplits] = useState<SplitDraft[]>([emptySplit(kind === "Advance" || max <= 0 ? "" : String(max))]);
  const [reason, setReason] = useState("");
  const [approvedBy, setApprovedBy] = useState("");
  const [writeOff, setWriteOff] = useState("");
  const [toPatient, setToPatient] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const settlement = kind === "Settlement";
  const total = splitsTotal(splits);
  const settled = r2(total + (Number(writeOff) || 0) + (Number(toPatient) || 0));

  async function submit() {
    setError(null);
    setErrors({});
    if (!settlement && !(total > 0)) return setErrors({ "splits.0": "Enter the amount" });
    if (kind === "Refund" && reason.trim().length < 3) return setErrors({ reason: "Enter the reason for the refund" });
    setBusy(true);
    try {
      await onSubmit({
        kind, splits: splitsPayload(splits), reason: reason.trim() || undefined, approvedBy: approvedBy.trim() || undefined,
        ...(settlement ? { writeOff: Number(writeOff) || 0, toPatient: Number(toPatient) || 0 } : {}),
      });
    } catch (e) {
      if (e instanceof ApiClientError && e.fields) setErrors(e.fields);
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={TITLE[kind]}
      description={settlement ? `${payerName ?? "Payer"} owes ${formatMoney(max)}` : kind === "Advance" ? "Held against the running bill until it is finalised" : kind === "Refund" ? `Up to ${formatMoney(max)} can be refunded` : `${formatMoney(max)} due from the patient`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Back</Button>
          <Button variant={kind === "Refund" ? "danger" : "primary"} onClick={submit} loading={busy}>{kind === "Refund" ? `Refund ${formatMoney(total)}` : settlement ? `Record ${formatMoney(settled)}` : `Receive ${formatMoney(total)}`}</Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}
        {!settlement && <ShiftNotice />}
        <div>
          <p className="mb-1.5 text-sm font-medium text-slate-700">{settlement ? "Amount received from the payer" : kind === "Refund" ? "Refunded by" : "Received by"}</p>
          <SplitsEditor splits={splits} onChange={setSplits} errors={errors} disabled={busy} />
          {settlement && <p className="mt-1 text-xs text-slate-500">Leave the amount blank if the payer paid nothing and you are only recording deductions.</p>}
        </div>
        {settlement && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Deducted by payer (write off)" htmlFor="rc-writeOff" error={errors.writeOff} hint="Hospital absorbs this">
              <input id="rc-writeOff" type="number" min={0} step="any" value={writeOff} onChange={(e) => setWriteOff(e.target.value)} className={cx(inputClass, errorRing(errors.writeOff))} />
            </Field>
            <Field label="Disallowed — collect from patient" htmlFor="rc-toPatient" error={errors.toPatient} hint="Moves to the patient's due">
              <input id="rc-toPatient" type="number" min={0} step="any" value={toPatient} onChange={(e) => setToPatient(e.target.value)} className={cx(inputClass, errorRing(errors.toPatient))} />
            </Field>
          </div>
        )}
        {(kind === "Refund" || settlement) && (
          <Field label={settlement ? "Reason for deduction / disallowance" : "Reason for refund"} htmlFor="rc-reason" required={kind === "Refund"} error={errors.reason}>
            <textarea id="rc-reason" rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} className={cx(inputClass, errorRing(errors.reason))} />
          </Field>
        )}
        {kind === "Refund" && (
          <Field label="Approved by" htmlFor="rc-approvedBy">
            <input id="rc-approvedBy" maxLength={80} value={approvedBy} onChange={(e) => setApprovedBy(e.target.value)} className={inputClass} />
          </Field>
        )}
      </div>
    </Modal>
  );
}
