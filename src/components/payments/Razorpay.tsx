"use client";

import { CreditCard, RefreshCw } from "lucide-react";
import { useState } from "react";
import { ApiClientError, api } from "@/lib/client";
import { formatDateTime, formatMoney } from "@/lib/format";
import { useApiQuery } from "@/lib/useApi";
import { Alert, Badge, Button, Field, Modal, inputClass, statusTone } from "../ui";

export type PayTargetKind = "lab_order" | "pharmacy_sale" | "ambulance_trip";

export interface GatewayConfig {
  enabled: boolean;
  source: "hospital" | "user" | null;
  label: string | null;
  keyId: string | null;
  mode: "test" | "live" | null;
}

export interface GatewayTxn {
  id: string;
  account: string;
  accountScope: "hospital" | "user" | null;
  keyId: string | null;
  mode: "test" | "live" | null;
  target: { kind: PayTargetKind; label: string; id: string; code: string; href: string | null };
  module: string | null;
  payerName: string | null;
  amount: number;
  orderId: string;
  paymentId: string | null;
  method: string | null;
  status: "Created" | "Applying" | "Applied" | "Unapplied" | "Failed";
  error: string | null;
  createdByName: string | null;
  createdAt: string | null;
  appliedAt: string | null;
}

export const TXN_STATUS_LABEL: Record<GatewayTxn["status"], string> = {
  Created: "Not completed",
  Applying: "Recording…",
  Applied: "Paid",
  Unapplied: "Paid · not recorded",
  Failed: "Failed",
};

/** Whether the signed-in user can collect online, and into which account. */
export function useGateway() {
  return useApiQuery<GatewayConfig>("/api/payments/razorpay/config").data;
}

/* ======================= checkout ======================= */

interface CheckoutOrder {
  txnId: string;
  keyId: string;
  orderId: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  prefill: { name: string; contact: string };
}
interface CheckoutResponse {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}
interface RazorpayInstance {
  open(): void;
  on(event: string, cb: (r: unknown) => void): void;
}
declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance;
  }
}

export class CheckoutClosed extends Error {
  constructor() {
    super("Payment window closed — nothing was charged.");
  }
}

let loader: Promise<void> | null = null;
export function loadCheckout() {
  if (window.Razorpay) return Promise.resolve();
  loader ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      loader = null;
      s.remove();
      reject(new Error("Could not load Razorpay checkout. Check the internet connection."));
    };
    document.body.appendChild(s);
  });
  return loader;
}

/** Raise an order, open Razorpay checkout, and have the server verify and record the payment. */
async function payOnline(kind: PayTargetKind, id: string, amount: number): Promise<GatewayTxn> {
  const { data: o } = await api<CheckoutOrder>("/api/payments/razorpay/orders", { method: "POST", body: { kind, id, amount } });
  await loadCheckout();
  const response = await new Promise<CheckoutResponse>((resolve, reject) => {
    const rz = new window.Razorpay!({
      key: o.keyId,
      amount: o.amount,
      currency: o.currency,
      order_id: o.orderId,
      name: o.name,
      description: o.description,
      prefill: o.prefill,
      theme: { color: "#16759a" },
      handler: resolve,
      modal: { ondismiss: () => reject(new CheckoutClosed()), confirm_close: true },
    });
    rz.open();
  });
  const { data } = await api<GatewayTxn>("/api/payments/razorpay/verify", { method: "POST", body: { txnId: o.txnId, ...response } });
  return data;
}

/* ======================= UI ======================= */

export function GatewayBadge({ mode }: { mode: "test" | "live" | null }) {
  if (!mode) return null;
  return <Badge tone={mode === "live" ? "green" : "amber"}>{mode === "live" ? "Live" : "Test mode"}</Badge>;
}

/** "Pay online" button for a payable record; hidden when no Razorpay account applies to this login. */
export function PayOnlineButton({ kind, id, due, onPaid, className }: { kind: PayTargetKind; id: string; due: number; onPaid: () => void; className?: string }) {
  const gateway = useGateway();
  const [open, setOpen] = useState(false);
  if (!gateway?.enabled || !(due > 0)) return null;
  return (
    <>
      <Button variant="secondary" className={className} onClick={() => setOpen(true)}><CreditCard className="size-4" /> Pay online</Button>
      {open && <OnlinePaymentModal kind={kind} id={id} due={due} gateway={gateway} onClose={() => setOpen(false)} onPaid={() => { setOpen(false); onPaid(); }} />}
    </>
  );
}

function OnlinePaymentModal({ kind, id, due, gateway, onClose, onPaid }: { kind: PayTargetKind; id: string; due: number; gateway: GatewayConfig; onClose: () => void; onPaid: () => void }) {
  const [amount, setAmount] = useState(String(due));
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const history = useApiQuery<GatewayTxn[]>(`/api/payments/razorpay/transactions?kind=${kind}&id=${id}&limit=5`);

  async function pay() {
    setError(null);
    setNotice(null);
    const value = Number(amount);
    if (!(value >= 1 && value <= due)) return setError(`Enter an amount between 1 and ${due}`);
    setBusy("pay");
    try {
      await payOnline(kind, id, value);
      onPaid();
    } catch (e) {
      if (e instanceof CheckoutClosed) setNotice(e.message);
      else setError(e instanceof ApiClientError && e.fields ? Object.values(e.fields)[0] : (e as Error).message);
      history.reload();
    } finally {
      setBusy(null);
    }
  }

  async function sync(txn: GatewayTxn) {
    setError(null);
    setNotice(null);
    setBusy(txn.id);
    try {
      const { data } = await api<GatewayTxn>(`/api/payments/razorpay/transactions/${txn.id}/sync`, { method: "POST" });
      if (data.status === "Applied") return onPaid();
      setNotice(data.status === "Failed" ? `Razorpay reports this payment failed${data.error ? `: ${data.error}` : ""}.` : "Razorpay has no completed payment for this order yet.");
      history.reload();
    } catch (e) {
      setError((e as Error).message);
      history.reload();
    } finally {
      setBusy(null);
    }
  }

  const pending = (history.data ?? []).filter((t) => t.status !== "Applied");
  return (
    <Modal open onClose={onClose} size="md" title="Collect online with Razorpay" description={`Balance due ${formatMoney(due)}`}
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy === "pay"}>Close</Button><Button loading={busy === "pay"} onClick={pay}><CreditCard className="size-4" /> Open Razorpay checkout</Button></>}>
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}
        {notice && <Alert tone="amber">{notice}</Alert>}
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
          Collected into <strong className="text-slate-900">{gateway.label}</strong>
          <span className="font-mono text-xs text-slate-500">{gateway.keyId}</span>
          <GatewayBadge mode={gateway.mode} />
        </div>
        <Field label="Amount" htmlFor="rzp-amount" required hint="The patient pays by UPI, card or net banking in the Razorpay window. The payment is recorded automatically once Razorpay confirms it.">
          <input id="rzp-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} className={inputClass} />
        </Field>
        {pending.length > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-medium text-slate-500">Earlier online attempts</p>
            <ul className="divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200">
              {pending.map((t) => (
                <li key={t.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="text-slate-800">{formatMoney(t.amount)} <Badge tone={t.status === "Unapplied" ? "red" : statusTone(TXN_STATUS_LABEL[t.status])}>{TXN_STATUS_LABEL[t.status]}</Badge></p>
                    <p className="truncate text-xs text-slate-500">{formatDateTime(t.createdAt)} · {t.createdByName}{t.error ? ` · ${t.error}` : ""}</p>
                  </div>
                  <Button variant="secondary" loading={busy === t.id} disabled={!!busy && busy !== t.id} onClick={() => sync(t)} title="Ask Razorpay whether this order was paid">
                    <RefreshCw className="size-3.5" /> Check
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}
