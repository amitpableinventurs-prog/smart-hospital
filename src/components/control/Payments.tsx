"use client";

import { FileText, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Alert, Badge, Button, Field, Modal, errorRing, inputClass, omitKey, statusTone } from "../ui";
import { ApiClientError, api } from "@/lib/client";
import { MANUAL_METHODS, durationLabel, priceOf, r2, type PaymentRow } from "@/lib/control-shared";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { useApiQuery } from "@/lib/useApi";

export interface PlanOption {
  id: string;
  code: string;
  name: string;
  modules: string[];
  durationDays: number;
  price: number;
  gstPct: number;
  graceDays: number;
  maxUsers: number;
  trial: boolean;
  active: boolean;
}
export interface PartnerOption {
  id: string;
  code: string;
  name: string;
  referralCode: string;
  commissionPct: number;
}

/** Plans and partners for the Control Panel's pickers. */
export function useSalesOptions() {
  return useApiQuery<{ plans: PlanOption[]; partners: PartnerOption[] }>("/api/control/sales/options");
}

const th = "whitespace-nowrap px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500";

export function PaymentStatusBadge({ p }: { p: Pick<PaymentRow, "status"> }) {
  return <Badge tone={p.status === "Created" ? "amber" : statusTone(p.status)}>{p.status === "Created" ? "Not completed" : p.status}</Badge>;
}

/** Licence payments with their actions (Control Panel). */
export function PaymentsTable({ rows, onChanged, showClient = true }: { rows: PaymentRow[]; onChanged: () => void; showClient?: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(p: PaymentRow, action: string) {
    setBusy(`${p.id}:${action}`);
    setError(null);
    try {
      await api(`/api/control/payments/${p.id}`, { method: "POST", body: { action } });
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      {error && <div className="p-4"><Alert>{error}</Alert></div>}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-100 text-sm">
          <thead className="bg-slate-50/60"><tr>{["Payment", ...(showClient ? ["Hospital"] : []), "Plan & period", "Amount", "Paid by", "Partner", ""].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((p) => (
              <tr key={p.id} className="align-top hover:bg-slate-50/60">
                <td className="px-4 py-2.5">
                  <p className="font-mono text-xs text-slate-900">{p.code}</p>
                  <PaymentStatusBadge p={p} />
                  <p className="mt-0.5 text-xs text-slate-500">{formatDateTime(p.paidAt ?? p.createdAt)}</p>
                </td>
                {showClient && (
                  <td className="px-4 py-2.5">
                    <Link href={`/super-admin/clients/${p.client.id}`} className="font-medium text-slate-900 hover:text-brand-700">{p.client.name}</Link>
                    <p className="font-mono text-xs text-slate-500">{p.client.code}</p>
                  </td>
                )}
                <td className="px-4 py-2.5">
                  <p className="text-slate-900">{p.plan.name} <span className="text-xs text-slate-500">· {durationLabel(p.durationDays)}</span></p>
                  {p.periodTo && <p className="text-xs text-slate-500">{formatDate(p.periodFrom)} – {formatDate(p.periodTo)}</p>}
                </td>
                <td className="px-4 py-2.5 tabular-nums">
                  <p className="font-medium text-slate-900">{formatMoney(p.total)}</p>
                  <p className="text-xs text-slate-500">{formatMoney(p.taxable)} + GST {formatMoney(p.gst)}{p.discount > 0 ? ` · −${formatMoney(p.discount)}${p.couponCode ? ` ${p.couponCode}` : ""}` : ""}</p>
                </td>
                <td className="px-4 py-2.5 text-slate-700">
                  {p.method}{p.channel === "Online" && <Badge tone="blue">In app</Badge>}
                  {p.reference && <p className="max-w-48 truncate text-xs text-slate-500" title={p.reference}>{p.reference}</p>}
                  {p.recordedByName && <p className="text-xs text-slate-500">by {p.recordedByName}</p>}
                  {p.error && <p className="text-xs text-red-700">{p.error}</p>}
                </td>
                <td className="px-4 py-2.5 text-slate-700">
                  {p.partner ? (
                    <>
                      <p>{p.partner.name}</p>
                      <p className="text-xs text-slate-500">{formatMoney(p.commission)} {p.status === "Paid" && (p.commissionPaid ? <Badge tone="green">Settled</Badge> : <Badge tone="amber">Due</Badge>)}</p>
                    </>
                  ) : <span className="text-slate-400">—</span>}
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 text-right">
                  <div className="flex justify-end gap-1">
                    {p.status === "Paid" && <Link href={`/super-admin/subscriptions/${p.id}`} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50"><FileText className="size-3.5" /> Invoice</Link>}
                    {p.status === "Paid" && p.partner && p.commission > 0 && (
                      <Button variant="ghost" className="px-2 py-1 text-xs" loading={!!busy?.startsWith(`${p.id}:commission`)} onClick={() => act(p, p.commissionPaid ? "commission-unpaid" : "commission-paid")}>{p.commissionPaid ? "Mark due" : "Commission paid"}</Button>
                    )}
                    {p.channel === "Online" && (p.status === "Created" || p.status === "Failed") && (
                      <Button variant="secondary" className="px-2 py-1 text-xs" loading={busy === `${p.id}:sync`} onClick={() => act(p, "sync")} title="Ask Razorpay whether this order was paid"><RefreshCw className="size-3.5" /> Check</Button>
                    )}
                    {p.status !== "Paid" && p.status !== "Cancelled" && <Button variant="ghost" className="px-2 py-1 text-xs" loading={busy === `${p.id}:cancel`} onClick={() => act(p, "cancel")}>Cancel</Button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** The vendor records a cash / bank / UPI payment: the licence is extended right away and comes back as an offline key. */
export function RecordPaymentModal({ client, onClose, onDone }: { client: { id: string; name: string; plan: { id: string } | null; trial: boolean; expiresAt: string | null }; onClose: () => void; onDone: (res: { payment: PaymentRow; offlineKey: string | null }) => void }) {
  const options = useSalesOptions();
  const plans = (options.data?.plans ?? []).filter((p) => p.active && !p.trial);
  const [v, setV] = useState({ plan: client.plan && !client.trial ? client.plan.id : "", method: "UPI", reference: "", paidOn: new Date().toISOString().slice(0, 10), coupon: "", extraDiscount: "", periodTo: "", notes: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setV((s) => ({ ...s, [k]: e.target.value }));
    if (errors[k]) setErrors((x) => omitKey(x, k));
  };
  const plan = plans.find((p) => p.id === (v.plan || plans[0]?.id));
  const preview = useMemo(() => {
    if (!plan) return null;
    const extra = Number(v.extraDiscount) || 0;
    const priced = priceOf(plan.price, plan.gstPct, extra ? { kind: "Flat", value: extra } : null);
    const base = !client.trial && client.expiresAt && new Date(client.expiresAt) > new Date() ? new Date(client.expiresAt) : new Date();
    return { ...priced, until: new Date(base.getTime() + plan.durationDays * 86_400_000).toISOString() };
  }, [plan, v.extraDiscount, client.trial, client.expiresAt]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const { data } = await api<{ payment: PaymentRow; offlineKey: string | null }>(`/api/control/clients/${client.id}/payments`, { method: "POST", body: { ...v, plan: v.plan || plan?.id, extraDiscount: r2(Number(v.extraDiscount) || 0) } });
      onDone(data);
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof ApiClientError && e.fields) setErrors(e.fields);
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} size="lg" title={`Record payment · ${client.name}`} description="For payments received outside the app (UPI, bank transfer, cash, cheque). The licence is extended immediately: an online hospital app picks it up at its next check-in, and you get a licence key for the paid period to give a hospital that runs offline."
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button onClick={submit} loading={busy} disabled={!plan}>Record & extend licence</Button></>}>
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}
        {options.data && plans.length === 0 && <Alert tone="amber">Create a paid plan under Plans & Pricing first.</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Plan" htmlFor="rp-plan" required error={errors.plan}>
            <select id="rp-plan" value={v.plan || plan?.id || ""} onChange={set("plan")} className={`${inputClass} ${errorRing(errors.plan)}`}>
              {plans.map((p) => <option key={p.id} value={p.id}>{p.name} — {formatMoney(p.price)} / {durationLabel(p.durationDays)}</option>)}
            </select>
          </Field>
          <Field label="Received by" htmlFor="rp-method" required error={errors.method}>
            <select id="rp-method" value={v.method} onChange={set("method")} className={inputClass}>{MANUAL_METHODS.map((m) => <option key={m}>{m}</option>)}</select>
          </Field>
          <Field label="Reference" htmlFor="rp-ref" hint="UTR / cheque no. / receipt no." error={errors.reference}><input id="rp-ref" value={v.reference} onChange={set("reference")} maxLength={80} className={inputClass} /></Field>
          <Field label="Payment date" htmlFor="rp-date" error={errors.paidOn}><input id="rp-date" type="date" value={v.paidOn} onChange={set("paidOn")} className={`${inputClass} ${errorRing(errors.paidOn)}`} /></Field>
          <Field label="Coupon code" htmlFor="rp-coupon" error={errors.coupon}><input id="rp-coupon" value={v.coupon} onChange={set("coupon")} className={`${inputClass} uppercase ${errorRing(errors.coupon)}`} /></Field>
          <Field label="Extra discount (₹)" htmlFor="rp-disc" hint="Negotiated discount before GST" error={errors.extraDiscount}><input id="rp-disc" type="number" min={0} value={v.extraDiscount} onChange={set("extraDiscount")} className={inputClass} /></Field>
          <Field label="Valid until (optional)" htmlFor="rp-to" hint="Leave blank to add the plan's duration" error={errors.periodTo}><input id="rp-to" type="date" value={v.periodTo} onChange={set("periodTo")} className={`${inputClass} ${errorRing(errors.periodTo)}`} /></Field>
          <Field label="Notes" htmlFor="rp-notes"><input id="rp-notes" value={v.notes} onChange={set("notes")} maxLength={300} className={inputClass} /></Field>
        </div>
        {preview && (
          <div className="rounded-lg bg-slate-50 p-3 text-sm ring-1 ring-slate-200">
            <div className="flex justify-between"><span className="text-slate-600">Price</span><span className="tabular-nums">{formatMoney(preview.price)}</span></div>
            {preview.discount > 0 && <div className="flex justify-between"><span className="text-slate-600">Extra discount</span><span className="tabular-nums">− {formatMoney(preview.discount)}</span></div>}
            <div className="flex justify-between"><span className="text-slate-600">GST {preview.gstPct}%</span><span className="tabular-nums">{formatMoney(preview.gst)}</span></div>
            <div className="mt-1 flex justify-between border-t border-slate-200 pt-1 font-semibold"><span>Total{v.coupon ? " (before coupon)" : ""}</span><span className="tabular-nums">{formatMoney(preview.total)}</span></div>
            <p className="mt-1 text-xs text-slate-500">Licence valid until about {formatDate(v.periodTo || preview.until)}{!client.trial && client.expiresAt && new Date(client.expiresAt) > new Date() ? " (added to the current expiry)" : ""}.</p>
          </div>
        )}
      </div>
    </Modal>
  );
}
