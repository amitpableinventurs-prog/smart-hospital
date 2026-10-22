"use client";

import { Check, CreditCard, FileText, Mail, Phone, RefreshCw, Tag } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CheckoutClosed, loadCheckout } from "../payments/Razorpay";
import { Alert, Badge, Button, Field, Modal, Spinner, cx, inputClass, statusTone } from "../ui";
import { ApiClientError, api } from "@/lib/client";
import { durationLabel, type PaymentRow, type Quote } from "@/lib/control-shared";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import type { RenewalInfo, RenewalOrder } from "@/lib/licence-protocol";
import { MODULE_MAP } from "@/lib/modules";

interface CheckoutResponse {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

const renewal = <T,>(body: Record<string, unknown>) => api<T>("/api/licence/renewal", { method: "POST", body }).then((r) => r.data);

/** Plans, payments and (for a chosen plan) a quote, from the vendor's Control Panel. Needs the internet. */
export function useRenewalInfo(enabled = true) {
  const [info, setInfo] = useState<RenewalInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setError(null);
    try {
      setInfo(await renewal<RenewalInfo>({ action: "info" }));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    // Fetch once when shown; not derived state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (enabled) void load();
  }, [enabled, load]);
  return { info, error, reload: load };
}

/** Buy, renew or upgrade the plan with Razorpay; the licence is updated as soon as the payment is confirmed. */
export function RenewModal({ onClose, onPaid }: { onClose: () => void; onPaid: (p: PaymentRow) => void }) {
  const { info, error: loadError, reload } = useRenewalInfo();
  const [plan, setPlan] = useState<string | null>(null);
  const [coupon, setCoupon] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const chosen = plan ?? info?.current.plan?.code ?? info?.plans[0]?.code ?? null;

  const price = useCallback(async (code: string, c: string) => {
    setBusy("quote");
    setCouponError(null);
    try {
      const res = await renewal<RenewalInfo>({ action: "info", plan: code, coupon: c });
      setQuote(res.quote);
    } catch (e) {
      if (e instanceof ApiClientError && e.fields?.coupon) setCouponError(e.fields.coupon);
      else setError((e as Error).message);
      setQuote(null);
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => {
    // Re-price whenever the plan changes; the coupon is applied with its button.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (chosen && info) void price(chosen, "");
  }, [chosen, info, price]);

  async function pay() {
    if (!chosen) return;
    setError(null);
    setNotice(null);
    setBusy("pay");
    try {
      const o = await renewal<RenewalOrder>({ action: "order", plan: chosen, coupon: quote?.coupon?.code ?? "" });
      await loadCheckout();
      const r = await new Promise<CheckoutResponse>((resolve, reject) => {
        const rz = new window.Razorpay!({
          key: o.keyId, amount: o.amount, currency: o.currency, order_id: o.orderId, name: o.name, description: o.description, prefill: o.prefill,
          theme: { color: getComputedStyle(document.documentElement).getPropertyValue("--color-brand-600").trim() || "#16759a" },
          handler: resolve, modal: { ondismiss: () => reject(new CheckoutClosed()), confirm_close: true },
        });
        rz.open();
      });
      const res = await renewal<{ payment: PaymentRow }>({ action: "verify", orderId: r.razorpay_order_id, paymentId: r.razorpay_payment_id, signature: r.razorpay_signature });
      if (res.payment.status === "Paid") onPaid(res.payment);
      else setNotice("The payment is not confirmed yet. Use “Check” in the payment list in a minute.");
    } catch (e) {
      if (e instanceof CheckoutClosed) setNotice(e.message);
      else setError(e instanceof ApiClientError && e.fields ? Object.values(e.fields)[0] : (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const online = info?.online.enabled;
  return (
    <Modal open onClose={onClose} size="xl" title="Renew or upgrade your plan" description="Pay securely with UPI, card or net banking. Your licence is extended as soon as the payment is confirmed."
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy === "pay"}>Close</Button>{online && <Button onClick={pay} loading={busy === "pay"} disabled={!quote || busy === "quote"}><CreditCard className="size-4" /> Pay {quote ? formatMoney(quote.total) : ""}</Button>}</>}>
      {loadError ? (
        <div className="space-y-3"><Alert>{loadError}</Alert><Button variant="secondary" onClick={reload}><RefreshCw className="size-4" /> Try again</Button></div>
      ) : !info ? (
        <Spinner label="Fetching plans from your vendor…" />
      ) : (
        <div className="space-y-5">
          {error && <Alert>{error}</Alert>}
          {notice && <Alert tone="amber">{notice}</Alert>}
          {info.plans.length === 0 ? (
            <Alert tone="amber">No plans are available online. Please contact your vendor.</Alert>
          ) : (
            <div className="grid gap-3 md:grid-cols-3">
              {info.plans.map((p) => {
                const on = chosen === p.code;
                return (
                  <button key={p.code} type="button" onClick={() => { setPlan(p.code); setCoupon(""); }} className={cx("flex flex-col rounded-xl p-4 text-left ring-1 ring-inset transition-colors", on ? "bg-brand-50 ring-2 ring-brand-500" : "ring-slate-200 hover:bg-slate-50")} aria-pressed={on}>
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-900">{p.name}</span>
                      {info.current.plan?.code === p.code && <Badge tone="blue">Current</Badge>}
                    </span>
                    <span className="mt-1 text-lg font-semibold tabular-nums text-slate-900">{formatMoney(p.price)}<span className="text-xs font-normal text-slate-500"> / {durationLabel(p.durationDays)} + GST</span></span>
                    {p.description && <span className="mt-1 text-xs text-slate-600">{p.description}</span>}
                    <span className="mt-2 text-xs text-slate-500">{p.modules.length} modules · {p.maxUsers ? `${p.maxUsers} staff logins` : "unlimited logins"}</span>
                    {p.features.length > 0 && <span className="mt-2 space-y-0.5 text-xs text-slate-700">{p.features.slice(0, 4).map((f) => <span key={f} className="flex gap-1"><Check className="size-3.5 shrink-0 text-emerald-600" />{f}</span>)}</span>}
                  </button>
                );
              })}
            </div>
          )}
          {chosen && (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-3">
                <Field label="Coupon code" htmlFor="rn-coupon" error={couponError ?? undefined}>
                  <div className="flex gap-2">
                    <input id="rn-coupon" value={coupon} onChange={(e) => { setCoupon(e.target.value.toUpperCase()); setCouponError(null); }} className={`${inputClass} font-mono uppercase`} placeholder="Optional" />
                    <Button variant="secondary" onClick={() => price(chosen, coupon)} loading={busy === "quote"} disabled={!coupon}><Tag className="size-4" /> Apply</Button>
                  </div>
                </Field>
                <p className="text-xs text-slate-500">Modules in this plan: {info.plans.find((p) => p.code === chosen)?.modules.map((m) => MODULE_MAP[m]?.label ?? m).join(", ")}</p>
                {!online && (
                  <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">
                    Online payment is not available. Pay {info.vendor.name} by bank transfer or UPI and they will extend your licence.
                    <VendorContact vendor={info.vendor} />
                  </div>
                )}
              </div>
              <div className="rounded-lg bg-slate-50 p-4 text-sm ring-1 ring-slate-200">
                {!quote ? (
                  <Spinner label="Pricing…" />
                ) : (
                  <>
                    <div className="flex justify-between"><span className="text-slate-600">{quote.plan.name} · {durationLabel(quote.plan.durationDays)}</span><span className="tabular-nums">{formatMoney(quote.price)}</span></div>
                    {quote.discount > 0 && <div className="flex justify-between text-emerald-700"><span>Coupon {quote.coupon?.code} ({quote.coupon?.label})</span><span className="tabular-nums">− {formatMoney(quote.discount)}</span></div>}
                    <div className="flex justify-between"><span className="text-slate-600">GST {quote.gstPct}%</span><span className="tabular-nums">{formatMoney(quote.gst)}</span></div>
                    <div className="mt-2 flex justify-between border-t border-slate-200 pt-2 text-base font-semibold"><span>Total</span><span className="tabular-nums">{formatMoney(quote.total)}</span></div>
                    <p className="mt-2 text-xs text-slate-500">Valid from {formatDate(quote.periodFrom)} until <strong className="text-slate-700">{formatDate(quote.periodTo)}</strong>{info.current.expiresAt && !info.current.trial && new Date(info.current.expiresAt) > new Date() ? " — added to your current licence." : "."}</p>
                  </>
                )}
              </div>
            </div>
          )}
          {online && info.online.mode === "test" && <p className="text-xs text-amber-700">The vendor&apos;s Razorpay account is in test mode — no real money is charged.</p>}
        </div>
      )}
    </Modal>
  );
}

export function VendorContact({ vendor, className }: { vendor: { name: string; phone: string | null; email: string | null; website?: string | null } | null; className?: string }) {
  if (!vendor || (!vendor.phone && !vendor.email)) return null;
  return (
    <span className={cx("mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm", className)}>
      {vendor.phone && <a href={`tel:${vendor.phone}`} className="inline-flex items-center gap-1 font-medium hover:underline"><Phone className="size-3.5" />{vendor.phone}</a>}
      {vendor.email && <a href={`mailto:${vendor.email}`} className="inline-flex items-center gap-1 font-medium hover:underline"><Mail className="size-3.5" />{vendor.email}</a>}
    </span>
  );
}

/** This hospital's licence payments (from the vendor), with invoices and a re-check for unfinished online payments. */
export function RenewalPayments({ payments, onChanged }: { payments: PaymentRow[]; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function check(p: PaymentRow) {
    setBusy(p.id);
    setError(null);
    try {
      const res = await renewal<{ payment: PaymentRow }>({ action: "verify", id: p.id });
      if (res.payment.status !== "Paid") setError("Razorpay has no completed payment for this order.");
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  if (!payments.length) return <p className="px-5 py-4 text-sm text-slate-500">No payments yet.</p>;
  return (
    <>
      {error && <div className="px-5 pt-3"><Alert>{error}</Alert></div>}
      <ul className="divide-y divide-slate-100">
        {payments.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5 text-sm">
            <div className="min-w-0 flex-1">
              <p className="text-slate-900">{p.plan.name} · {formatMoney(p.total)} <Badge tone={p.status === "Created" ? "amber" : statusTone(p.status)}>{p.status === "Created" ? "Not completed" : p.status}</Badge></p>
              <p className="text-xs text-slate-500">{formatDateTime(p.paidAt ?? p.createdAt)} · {p.method}{p.periodTo && p.status === "Paid" ? ` · until ${formatDate(p.periodTo)}` : ""}</p>
            </div>
            {p.status === "Paid" ? (
              <Link href={`/super-admin/licence/invoice/${p.id}`} className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline"><FileText className="size-3.5" /> Invoice {p.code}</Link>
            ) : p.channel === "Online" && p.status !== "Cancelled" ? (
              <Button variant="secondary" className="px-2 py-1 text-xs" loading={busy === p.id} onClick={() => check(p)}><RefreshCw className="size-3.5" /> Check</Button>
            ) : null}
          </li>
        ))}
      </ul>
    </>
  );
}
