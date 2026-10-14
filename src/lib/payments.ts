import "server-only";
import mongoose from "mongoose";
import { tripAction } from "./ambulance";
import { ApiError, escapeRegex, pagination, parsePaging } from "./api";
import { addPayment } from "./laboratory";
import { receivePayment } from "./pharmacy";
import { accountById, accountFor, rzp, signatureValid, type ResolvedAccount } from "./razorpay";
import { canAccess, type SessionUser } from "./session";
import { isObjectId } from "./validation";
import { Trip } from "@/models/ambulance";
import { LabOrder } from "@/models/laboratory";
import { GatewayTxn, PAY_TARGETS, type PayTargetKind } from "@/models/payments";
import { Sale } from "@/models/pharmacy";

/* ======================= what can be paid online ======================= */

interface Due {
  code: string;
  due: number;
  payer: { name?: string; contact?: string };
  description: string;
}

interface Applied {
  mode: string;
  amount: number;
  reference: string;
}

/**
 * Each payable record: how much is due on it, and how to record a captured
 * payment using the module's own payment logic (same checks and audit trail).
 */
const TARGETS: Record<PayTargetKind, { module: string; label: string; due: (id: string) => Promise<Due>; apply: (id: string, p: Applied, user: SessionUser, req: Request) => Promise<unknown> }> = {
  lab_order: {
    module: "laboratory",
    label: "Lab order",
    async due(id) {
      const o = await LabOrder.findById(id).select("code netAmount paidAmount status patientName patientMobile").lean();
      if (!o) throw new ApiError(404, "Lab order not found");
      if (o.status === "Cancelled") throw new ApiError(409, "Cancelled orders cannot take payments");
      return { code: o.code, due: r2((o.netAmount ?? 0) - (o.paidAmount ?? 0)), payer: { name: o.patientName, contact: o.patientMobile ?? undefined }, description: `Lab order ${o.code}` };
    },
    apply: (id, p, user, req) => addPayment(id, { kind: "Payment", amount: p.amount, mode: p.mode, reference: p.reference }, user, req),
  },
  pharmacy_sale: {
    module: "pharmacy",
    label: "Pharmacy bill",
    async due(id) {
      const s = await Sale.findById(id).select("code netAmount paidAmount status customerName customerPhone").lean();
      if (!s) throw new ApiError(404, "Bill not found");
      if (s.status === "Cancelled") throw new ApiError(409, "Cancelled bills cannot take payments");
      return { code: s.code, due: r2((s.netAmount ?? 0) - (s.paidAmount ?? 0)), payer: { name: s.customerName, contact: s.customerPhone ?? undefined }, description: `Pharmacy bill ${s.code}` };
    },
    apply: (id, p, user, req) => receivePayment(id, { amount: p.amount, paymentMode: p.mode, reference: p.reference }, user, req),
  },
  ambulance_trip: {
    module: "ambulance",
    label: "Ambulance trip",
    async due(id) {
      const t = await Trip.findById(id).select("code status billingMode charges paidAmount patientName callerName callerPhone").lean();
      if (!t) throw new ApiError(404, "Trip not found");
      if (t.billingMode !== "Collect" || t.status !== "Completed") throw new ApiError(409, "Payments are collected on completed trips charged directly");
      return { code: t.code, due: r2((t.charges?.total ?? 0) - (t.paidAmount ?? 0)), payer: { name: t.patientName || t.callerName || undefined, contact: t.callerPhone ?? undefined }, description: `Ambulance trip ${t.code}` };
    },
    apply: (id, p, user, req) => tripAction(id, { action: "pay", mode: p.mode, amount: p.amount, reference: p.reference }, user, req),
  },
};

function r2(n: number) {
  return Math.round(n * 100) / 100;
}

function target(kind: unknown) {
  if (!(PAY_TARGETS as readonly unknown[]).includes(kind)) throw new ApiError(400, "Unknown payment target");
  return { kind: kind as PayTargetKind, ...TARGETS[kind as PayTargetKind] };
}

/** Razorpay's method → the hospital's payment modes. */
function modeOf(method: string | undefined) {
  if (method === "upi") return "UPI";
  if (method === "card" || method === "emi") return "Card";
  return "Bank Transfer";
}

/* ======================= checkout ======================= */

export async function gatewayFor(user: SessionUser) {
  const a = await accountFor(user);
  return a ? { enabled: true, source: a.scope, label: a.label, keyId: a.keyId, mode: a.mode } : { enabled: false, source: null, label: null, keyId: null, mode: null };
}

interface RzpOrder {
  id: string;
  amount: number;
  currency: string;
  status: string;
}
interface RzpPayment {
  id: string;
  order_id: string;
  amount: number;
  currency: string;
  status: "created" | "authorized" | "captured" | "refunded" | "failed";
  method?: string;
  error_description?: string;
}

/** Raise a Razorpay order for { kind, id, amount } on the caller's account. */
export async function createOrder(body: Record<string, unknown>, user: SessionUser) {
  const t = target(body.kind);
  const id = String(body.id ?? "");
  if (!isObjectId(id)) throw new ApiError(404, `${t.label} not found`);
  if (!canAccess(user, t.module)) throw new ApiError(403, "You are not assigned to this module.");

  const account = await accountFor(user);
  if (!account) throw new ApiError(409, "Online payments are not set up for your login. Add your Razorpay keys under Account → Razorpay, or ask the super admin.");

  const info = await t.due(id);
  const amount = r2(Number(body.amount));
  if (!(info.due > 0)) throw new ApiError(422, "Nothing is due", { amount: "Nothing is due on this record" });
  if (!(amount >= 1 && amount <= info.due)) throw new ApiError(422, "Check the amount", { amount: `Enter an amount between 1 and ${info.due}` });

  const txnId = new mongoose.Types.ObjectId();
  const order = await rzp<RzpOrder>(account.credentials(), "POST", "/orders", {
    amount: Math.round(amount * 100),
    currency: "INR",
    receipt: String(txnId),
    notes: { record: info.description, collected_by: user.name },
  });

  const txn = await GatewayTxn.create({
    _id: txnId,
    account: account.id, accountScope: account.scope, accountLabel: account.label, keyId: account.keyId, mode: account.mode,
    targetKind: t.kind, targetId: id, targetCode: info.code, module: t.module, payerName: info.payer.name,
    amount, currency: "INR", orderId: order.id, createdBy: user.id, createdByName: user.name,
  });

  return {
    txnId: String(txn._id),
    keyId: account.keyId,
    orderId: order.id,
    amount: order.amount,
    currency: order.currency,
    name: account.displayName,
    description: info.description,
    prefill: { name: info.payer.name ?? "", contact: info.payer.contact ?? "" },
    mode: account.mode,
    accountLabel: account.label,
  };
}

async function loadTxn(id: string, user: SessionUser) {
  if (!isObjectId(id)) throw new ApiError(404, "Payment not found");
  const txn = await GatewayTxn.findById(id);
  if (!txn) throw new ApiError(404, "Payment not found");
  if (user.role !== "super_admin" && String(txn.createdBy) !== user.id) throw new ApiError(403, "Only the person who started this payment can complete it.");
  return txn;
}

/**
 * Record a captured Razorpay payment on its record exactly once. The txn is
 * claimed by moving it to "Applying"; if the module rejects the payment (say
 * the balance was paid in cash meanwhile) it is left "Unapplied" for follow-up.
 */
async function applyCaptured(txnId: unknown, payment: RzpPayment, account: ResolvedAccount, user: SessionUser, req: Request) {
  if (payment.status === "authorized") {
    payment = await rzp<RzpPayment>(account.credentials(), "POST", `/payments/${payment.id}/capture`, { amount: payment.amount, currency: payment.currency });
  }
  if (payment.status !== "captured") throw new ApiError(409, `Payment is ${payment.status} at Razorpay`);

  const claimed = await GatewayTxn.findOneAndUpdate(
    { _id: txnId, status: { $in: ["Created", "Failed", "Unapplied"] } },
    { $set: { status: "Applying", paymentId: payment.id, method: payment.method, error: undefined } },
    { returnDocument: "after" }
  );
  if (!claimed) {
    const current = await GatewayTxn.findById(txnId).lean();
    if (current?.status === "Applied") return current;
    throw new ApiError(409, "This payment is already being recorded");
  }

  const amount = r2(payment.amount / 100);
  try {
    await TARGETS[claimed.targetKind as PayTargetKind].apply(String(claimed.targetId), { amount, mode: modeOf(payment.method), reference: `Razorpay ${payment.id}` }, user, req);
  } catch (e) {
    const message = e instanceof ApiError && e.fields ? Object.values(e.fields)[0] : (e as Error).message;
    await GatewayTxn.updateOne({ _id: claimed._id }, { $set: { status: "Unapplied", error: `Paid at Razorpay but not recorded: ${message}` } });
    throw new ApiError(409, `₹${amount} was received on Razorpay (${payment.id}) but could not be recorded: ${message}. It is listed under Payment Gateway for follow-up.`);
  }
  return GatewayTxn.findByIdAndUpdate(claimed._id, { $set: { status: "Applied", amount, appliedAt: new Date() } }, { returnDocument: "after" }).lean();
}

/** Checkout success callback: { txnId, razorpay_order_id, razorpay_payment_id, razorpay_signature }. */
export async function verifyPayment(body: Record<string, unknown>, user: SessionUser, req: Request) {
  const txn = await loadTxn(String(body.txnId ?? ""), user);
  const orderId = String(body.razorpay_order_id ?? "");
  const paymentId = String(body.razorpay_payment_id ?? "");
  if (orderId !== txn.orderId || !/^pay_[A-Za-z0-9]+$/.test(paymentId)) throw new ApiError(400, "Payment details do not match this order");
  if (txn.status === "Applied") return serializeTxn(txn.toObject());

  const account = await accountById(txn.account);
  const cred = account.credentials();
  if (!signatureValid(cred.secret, orderId, paymentId, String(body.razorpay_signature ?? ""))) {
    throw new ApiError(400, "Razorpay signature check failed — the payment was not recorded");
  }
  const payment = await rzp<RzpPayment>(cred, "GET", `/payments/${paymentId}`);
  if (payment.order_id !== txn.orderId) throw new ApiError(400, "Payment does not belong to this order");
  return serializeTxn(await applyCaptured(txn._id, payment, account, user, req));
}

/**
 * Ask Razorpay what happened to an order — for when the browser closed after
 * paying, or a captured payment could not be recorded the first time.
 */
export async function syncTxn(id: string, user: SessionUser, req: Request) {
  const txn = await loadTxn(id, user);
  if (txn.status === "Applied") return serializeTxn(txn.toObject());
  const account = await accountById(txn.account);
  const { items } = await rzp<{ items: RzpPayment[] }>(account.credentials(), "GET", `/orders/${txn.orderId}/payments`);
  const paid = items.find((p) => p.status === "captured") ?? items.find((p) => p.status === "authorized");
  if (paid) return serializeTxn(await applyCaptured(txn._id, paid, account, user, req));

  const failed = items.find((p) => p.status === "failed");
  if (failed && txn.status === "Created") {
    txn.status = "Failed";
    txn.error = failed.error_description || "Payment failed at Razorpay";
    await txn.save();
  }
  return serializeTxn(txn.toObject());
}

/* ======================= listing ======================= */

interface TxnLike {
  _id: unknown;
  accountScope?: string | null;
  accountLabel?: string | null;
  keyId?: string | null;
  mode?: string | null;
  targetKind: string;
  targetId: unknown;
  targetCode?: string | null;
  module?: string | null;
  payerName?: string | null;
  amount: number;
  orderId: string;
  paymentId?: string | null;
  method?: string | null;
  status: string;
  error?: string | null;
  createdByName?: string | null;
  createdAt?: Date;
  appliedAt?: Date | null;
}

const TARGET_HREF: Record<string, (id: string) => string> = {
  lab_order: (id) => `/laboratory/orders/${id}`,
  pharmacy_sale: (id) => `/pharmacy/sales/${id}`,
  ambulance_trip: (id) => `/ambulance/trips/${id}`,
};

export function serializeTxn(t: TxnLike | null) {
  if (!t) throw new ApiError(404, "Payment not found");
  return {
    id: String(t._id),
    account: t.accountLabel ?? "",
    accountScope: t.accountScope ?? null,
    keyId: t.keyId ?? null,
    mode: t.mode ?? null,
    target: { kind: t.targetKind, label: TARGETS[t.targetKind as PayTargetKind]?.label ?? t.targetKind, id: String(t.targetId), code: t.targetCode ?? "", href: TARGET_HREF[t.targetKind]?.(String(t.targetId)) ?? null },
    module: t.module ?? null,
    payerName: t.payerName ?? null,
    amount: t.amount,
    orderId: t.orderId,
    paymentId: t.paymentId ?? null,
    method: t.method ?? null,
    status: t.status,
    error: t.error ?? null,
    createdByName: t.createdByName ?? null,
    createdAt: t.createdAt ? new Date(t.createdAt).toISOString() : null,
    appliedAt: t.appliedAt ? new Date(t.appliedAt).toISOString() : null,
  };
}

/**
 * Online payments. Super admins see all; admins see the ones they collected.
 * Filters: kind + id (one record), status, q (code / payer / payment id).
 */
export async function listTxns(url: URL, user: SessionUser) {
  const { page, limit, skip } = parsePaging(url, 20);
  const filter: Record<string, unknown> = {};
  if (user.role !== "super_admin") filter.createdBy = new mongoose.Types.ObjectId(user.id);
  const kind = url.searchParams.get("kind");
  const id = url.searchParams.get("id");
  if (kind && (PAY_TARGETS as readonly string[]).includes(kind) && id && isObjectId(id)) Object.assign(filter, { targetKind: kind, targetId: new mongoose.Types.ObjectId(id) });
  const status = url.searchParams.get("status");
  if (status === "attention") filter.status = "Unapplied";
  else if (status) filter.status = status;
  const q = url.searchParams.get("q")?.trim();
  if (q) {
    const rx = new RegExp(escapeRegex(q), "i");
    filter.$or = [{ targetCode: rx }, { payerName: rx }, { paymentId: rx }, { orderId: rx }, { createdByName: rx }];
  }
  const [rows, total] = await Promise.all([
    GatewayTxn.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    GatewayTxn.countDocuments(filter),
  ]);
  return { rows: rows.map((r) => serializeTxn(r as TxnLike)), pagination: pagination(page, limit, total) };
}
