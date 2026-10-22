import "server-only";
import mongoose from "mongoose";
import { ApiError, clientIp, escapeRegex, pagination, parsePaging } from "./api";
import { logActivity } from "./audit";
import { assertControl, authInstallation, bindInstallation, fail, insertClient, loadClient, payload, text, vendorInfo, type ClientDocument } from "./control";
import { MANUAL_METHODS, durationLabel, priceOf, r2, type InvoiceView, type PaymentRow, type PlanRow, type Quote } from "./control-shared";
import type { RenewalInfo, RenewalOrder } from "./licence-protocol";
import { isModuleKey } from "./modules";
import { accountById, hospitalAccount, rzp, signatureValid, type ResolvedAccount } from "./razorpay";
import { newLeadCode, phoneOf } from "./sales";
import type { SessionUser } from "./session";
import { isObjectId, isValidEmail } from "./validation";
import { nextCode } from "@/models/Counter";
import { ControlClient, ControlCoupon, ControlLead, ControlPartner, ControlPayment, ControlPlan } from "@/models/control";

/**
 * Control Panel: subscription plans and what hospitals pay for them. A paid
 * plan sets the client's modules, user limit and grace period and moves its
 * expiry on by the plan's duration (from the current expiry while it is still
 * running, otherwise from today). Hospitals pay from their own app through
 * the vendor's Razorpay account (Payment Gateway on this server), or the
 * vendor records cash / bank / UPI payments by hand. New hospitals can start
 * a free trial from the setup screen without a licence key.
 */

const DAY = 86_400_000;
const iso = (d: unknown) => (d instanceof Date ? d.toISOString() : null);

type PlanLean = mongoose.InferSchemaType<typeof ControlPlan.schema> & { _id: mongoose.Types.ObjectId };
type CouponLean = mongoose.InferSchemaType<typeof ControlCoupon.schema> & { _id: mongoose.Types.ObjectId };
type PaymentDoc = mongoose.HydratedDocument<mongoose.InferSchemaType<typeof ControlPayment.schema>>;

interface RzpOrder {
  id: string;
  amount: number;
  currency: string;
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

/* ======================= simple rate limit (public endpoints) ======================= */

const hits = new Map<string, number[]>();
function rateLimit(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) throw new ApiError(429, "Too many requests. Please try again later.");
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
}

/* ======================= plans ======================= */

function planOut(p: PlanLean, clients = 0): PlanRow {
  return {
    id: String(p._id), code: p.code, name: p.name, description: p.description ?? null, features: p.features ?? [], modules: (p.modules ?? []).filter(isModuleKey),
    durationDays: p.durationDays, price: p.price, gstPct: p.gstPct ?? 0, graceDays: p.graceDays ?? 15, maxUsers: p.maxUsers ?? 0, trial: !!p.trial,
    public: p.public !== false, active: p.active !== false, sortOrder: p.sortOrder ?? 0, clients,
  };
}

export async function listPlans() {
  assertControl();
  const [plans, counts] = await Promise.all([
    ControlPlan.find().sort({ sortOrder: 1, price: 1 }).lean(),
    ControlClient.aggregate<{ _id: unknown; n: number }>([{ $match: { plan: { $ne: null } } }, { $group: { _id: "$plan", n: { $sum: 1 } } }]),
  ]);
  const by = new Map(counts.map((c) => [String(c._id), c.n]));
  return plans.map((p) => planOut(p as PlanLean, by.get(String(p._id)) ?? 0));
}

const GST_SLABS = [0, 5, 12, 18, 28];

function parsePlan(body: Record<string, unknown>, partial: boolean) {
  const errors: Record<string, string> = {};
  const set: Record<string, unknown> = {};
  const has = (k: string) => !partial || k in body;
  const int = (k: string, min: number, max: number, fallback: number, message: string) => {
    if (!has(k)) return;
    const n = body[k] === "" || body[k] === undefined || body[k] === null ? fallback : Number(body[k]);
    if (!(Number.isInteger(n) && n >= min && n <= max)) errors[k] = message;
    set[k] = n;
  };
  if (has("code")) {
    const code = text(body.code, 20).toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9_-]{1,19}$/.test(code)) errors.code = "2–20 letters, digits, - or _ (e.g. BASIC)";
    set.code = code;
  }
  if (has("name")) {
    const name = text(body.name, 60);
    if (name.length < 2) errors.name = "Enter the plan's name";
    set.name = name;
  }
  if (has("description")) set.description = text(body.description, 300) || undefined;
  if (has("features")) {
    const list = Array.isArray(body.features) ? body.features : typeof body.features === "string" ? body.features.split(/\r?\n/) : [];
    set.features = list.map((f) => text(f, 120)).filter(Boolean).slice(0, 20);
  }
  if (has("modules")) {
    const mods = Array.isArray(body.modules) ? [...new Set(body.modules)] : [];
    if (!mods.length) errors.modules = "Select at least one module";
    else if (!mods.every(isModuleKey)) errors.modules = "Unknown module selected";
    set.modules = mods;
  }
  int("durationDays", 1, 3650, 365, "1 to 3650 days");
  if (has("price")) {
    const n = Number(body.price ?? 0);
    if (!(Number.isFinite(n) && n >= 0 && n <= 10_000_000)) errors.price = "Enter the price before GST";
    set.price = r2(n);
  }
  if (has("gstPct")) {
    const n = Number(body.gstPct ?? 18);
    if (!GST_SLABS.includes(n)) errors.gstPct = "0, 5, 12, 18 or 28 %";
    set.gstPct = n;
  }
  int("graceDays", 1, 365, 15, "1 to 365 days");
  int("maxUsers", 0, 10_000, 0, "0 (unlimited) or more");
  int("sortOrder", -1000, 1000, 0, "A whole number");
  for (const k of ["trial", "public", "active"] as const) if (has(k)) set[k] = typeof body[k] === "boolean" ? body[k] : k !== "trial";
  if (Object.keys(errors).length) fail(errors);
  return set;
}

export async function createPlan(body: Record<string, unknown>, user: SessionUser, req: Request) {
  assertControl();
  const set = parsePlan(body, false);
  if (await ControlPlan.exists({ code: String(set.code) })) fail({ code: "A plan with this code exists" });
  if (set.trial) await ControlPlan.updateMany({ trial: true }, { $set: { trial: false } });
  const p = await ControlPlan.create(set);
  await logActivity({ req, user, action: "create", module: "system", resource: "control_plans", entityId: String(p._id), entityLabel: p.code, summary: `Created plan ${p.name} (${p.code}): ₹${p.price} for ${durationLabel(p.durationDays)}${p.trial ? ", free trial" : ""}` });
  return planOut(p.toObject() as PlanLean);
}

/** `applyToClients: true` also gives every client on this plan its new modules, grace period and user limit now. */
export async function updatePlan(id: string, body: Record<string, unknown>, user: SessionUser, req: Request) {
  assertControl();
  if (!isObjectId(id)) throw new ApiError(404, "Plan not found");
  const p = await ControlPlan.findById(id);
  if (!p) throw new ApiError(404, "Plan not found");
  const set = parsePlan(body, true);
  if (set.code && set.code !== p.code && (await ControlPlan.exists({ code: String(set.code), _id: { $ne: id } }))) fail({ code: "A plan with this code exists" });
  if (set.trial) await ControlPlan.updateMany({ trial: true, _id: { $ne: id } }, { $set: { trial: false } });
  const changed = Object.keys(set).filter((k) => JSON.stringify(set[k] ?? null) !== JSON.stringify(p.get(k) ?? null));
  p.set(set);
  await p.save();
  const sync: Record<string, unknown> = { planCode: p.code, planName: p.name };
  if (body.applyToClients === true) Object.assign(sync, { modules: p.modules, graceDays: p.graceDays, maxUsers: p.maxUsers });
  const res = await ControlClient.updateMany({ plan: p._id }, { $set: sync });
  if (changed.length || body.applyToClients === true) {
    await logActivity({
      req, user, action: "update", module: "system", resource: "control_plans", entityId: id, entityLabel: p.code, changedFields: changed,
      summary: `Updated plan ${p.name}: ${changed.join(", ") || "no field changes"}${body.applyToClients === true ? `; applied to ${res.modifiedCount} client(s)` : ""}`,
    });
  }
  return planOut(p.toObject() as PlanLean, await ControlClient.countDocuments({ plan: p._id }));
}

export async function deletePlan(id: string, user: SessionUser, req: Request) {
  assertControl();
  if (!isObjectId(id)) throw new ApiError(404, "Plan not found");
  const [clients, payments] = await Promise.all([ControlClient.exists({ plan: id }), ControlPayment.exists({ plan: id })]);
  if (clients || payments) throw new ApiError(409, "Clients or payments use this plan. Turn off “Active” to stop selling it instead.");
  const p = await ControlPlan.findByIdAndDelete(id).lean();
  if (!p) throw new ApiError(404, "Plan not found");
  await logActivity({ req, user, action: "delete", module: "system", resource: "control_plans", entityId: id, entityLabel: p.code, summary: `Deleted plan ${p.name} (${p.code})` });
  return { deleted: true };
}

/** For the public pricing page: plans on sale and the free trial, if any. */
export async function publicPlans() {
  const plans = (await ControlPlan.find({ active: true, public: true }).sort({ sortOrder: 1, price: 1 }).lean()) as PlanLean[];
  return { plans: plans.filter((p) => !p.trial).map((p) => planOut(p)), trial: plans.find((p) => p.trial) ? planOut(plans.find((p) => p.trial)!) : null, vendor: vendorInfo() };
}

/* ======================= quotes ======================= */

async function couponFor(code: string, planId: unknown): Promise<CouponLean | null> {
  if (!code) return null;
  const c = (await ControlCoupon.findOne({ code: code.toUpperCase().trim() }).lean()) as CouponLean | null;
  const now = Date.now();
  if (!c || c.active === false) fail({ coupon: "This coupon code is not valid" });
  if (c.validFrom && c.validFrom.getTime() > now) fail({ coupon: "This coupon is not active yet" });
  if (c.validTo && c.validTo.getTime() < now) fail({ coupon: "This coupon has expired" });
  if (c.maxUses && (c.used ?? 0) >= c.maxUses) fail({ coupon: "This coupon has been fully used" });
  if (c.plans?.length && !c.plans.some((p) => String(p) === String(planId))) fail({ coupon: "This coupon does not apply to this plan" });
  return c;
}

/** The licence runs from the current expiry while it is still valid (paid plans), otherwise from today. */
function periodFor(c: ClientDocument, durationDays: number) {
  const now = new Date();
  const from = !c.trial && c.expiresAt && c.expiresAt > now ? c.expiresAt : now;
  const to = new Date(from.getTime() + durationDays * DAY);
  to.setUTCHours(23, 59, 59, 999);
  return { from, to };
}

async function buildQuote(c: ClientDocument, plan: { id?: unknown; code?: unknown }, couponCode: string, opts: { online: boolean; extraDiscount?: number }) {
  const p = (plan.id && isObjectId(plan.id)
    ? await ControlPlan.findById(plan.id).lean()
    : plan.code ? await ControlPlan.findOne({ code: String(plan.code).toUpperCase() }).lean() : null) as PlanLean | null;
  if (!p || p.active === false) fail({ plan: "Choose a plan" });
  if (p.trial) fail({ plan: "The free-trial plan cannot be bought" });
  if (opts.online && p.public === false) fail({ plan: "This plan is not available online. Contact your vendor." });
  const coupon = await couponFor(couponCode, p._id);
  const priced = priceOf(p.price, p.gstPct ?? 0, coupon);
  if (opts.extraDiscount) {
    const discount = r2(Math.min(priced.price, priced.discount + opts.extraDiscount));
    Object.assign(priced, priceOf(p.price, p.gstPct ?? 0, { kind: "Flat", value: discount }));
  }
  const period = periodFor(c, p.durationDays);
  const quote: Quote = {
    plan: { code: p.code, name: p.name, durationDays: p.durationDays }, ...priced,
    coupon: coupon ? { code: coupon.code, label: coupon.kind === "Percent" ? `${coupon.value}% off` : `₹${coupon.value} off` } : null,
    periodFrom: period.from.toISOString(), periodTo: period.to.toISOString(),
  };
  // Commission goes to the coupon's partner, otherwise to the partner who brought the client.
  const partnerId = coupon?.partner ?? c.partner;
  const partner = partnerId ? await ControlPartner.findOne({ _id: partnerId, active: true }).select("name commissionPct").lean() : null;
  return { plan: p, coupon, quote, partner };
}

/* ======================= payments ======================= */

function paymentOut(p: Record<string, unknown>): PaymentRow {
  return {
    id: String(p._id), code: p.code as string,
    client: { id: String(p.client), code: (p.clientCode as string) ?? "", name: (p.clientName as string) ?? "" },
    plan: { code: (p.planCode as string) ?? "", name: (p.planName as string) ?? "" }, durationDays: (p.durationDays as number) ?? 0,
    channel: p.channel as PaymentRow["channel"], method: p.method as string, status: p.status as PaymentRow["status"],
    price: p.price as number, discount: (p.discount as number) ?? 0, couponCode: (p.couponCode as string) ?? null, taxable: p.taxable as number, gstPct: (p.gstPct as number) ?? 0, gst: (p.gst as number) ?? 0, total: p.total as number,
    reference: (p.reference as string) ?? (p.paymentId as string) ?? null, periodFrom: iso(p.periodFrom), periodTo: iso(p.periodTo), paidAt: iso(p.paidAt),
    partner: p.partner ? { id: String(p.partner), name: (p.partnerName as string) ?? "" } : null, commission: (p.commission as number) ?? 0, commissionPaid: !!p.commissionPaid,
    notes: (p.notes as string) ?? null, recordedByName: (p.recordedByName as string) ?? null, error: (p.error as string) ?? null, createdAt: iso(p.createdAt),
  };
}

async function newPayment(c: ClientDocument, q: Awaited<ReturnType<typeof buildQuote>>, extra: Record<string, unknown>) {
  const commissionPct = q.partner?.commissionPct ?? 0;
  return (await ControlPayment.create({
    code: await nextCode("SUB"), client: c._id, clientCode: c.code, clientName: c.name,
    plan: q.plan._id, planCode: q.plan.code, planName: q.plan.name, durationDays: q.plan.durationDays,
    price: q.quote.price, discount: q.quote.discount, coupon: q.coupon?._id, couponCode: q.coupon?.code, taxable: q.quote.taxable, gstPct: q.quote.gstPct, gst: q.quote.gst, total: q.quote.total,
    periodFrom: new Date(q.quote.periodFrom), periodTo: new Date(q.quote.periodTo),
    partner: q.partner?._id, partnerName: q.partner?.name, commissionPct, commission: r2((q.quote.taxable * commissionPct) / 100),
    ...extra,
  })) as PaymentDoc;
}

/**
 * Exactly once per payment: mark it paid and give the client the plan until
 * the end of the period (recomputed now unless `period` is given).
 */
async function markPaid(id: unknown, set: Record<string, unknown>, ctx: { req: Request; user: SessionUser | null; period?: { from: Date; to: Date } }) {
  const p = (await ControlPayment.findOneAndUpdate({ _id: id, status: { $in: ["Created", "Failed"] } }, { $set: { status: "Paid", paidAt: new Date(), ...set, error: undefined } }, { returnDocument: "after" })) as PaymentDoc | null;
  if (!p) {
    const current = (await ControlPayment.findById(id)) as PaymentDoc | null;
    if (current?.status === "Paid") return current;
    throw new ApiError(409, "This payment was cancelled");
  }
  const c = (await ControlClient.findById(p.client)) as ClientDocument;
  const plan = (await ControlPlan.findById(p.plan).lean()) as PlanLean | null;
  const period = ctx.period ?? periodFor(c, p.durationDays);
  c.set({
    plan: p.plan, planCode: p.planCode, planName: p.planName, trial: false, expiresAt: period.to,
    ...(plan ? { modules: plan.modules, graceDays: plan.graceDays, maxUsers: plan.maxUsers } : {}),
    ...(!c.partner && p.partner ? { partner: p.partner } : {}),
  });
  await c.save();
  p.set({ periodFrom: period.from, periodTo: period.to });
  await p.save();
  await Promise.all([
    p.coupon ? ControlCoupon.updateOne({ _id: p.coupon }, { $inc: { used: 1 } }) : null,
    c.lead ? ControlLead.updateOne({ _id: c.lead, status: { $ne: "Won" } }, { $set: { status: "Won", wonAt: new Date() } }) : null,
  ]);
  await logActivity({
    req: ctx.req, user: ctx.user, actorEmail: ctx.user ? undefined : `installation@${c.code}`, action: "create", module: "system", resource: "control_payments", entityId: String(p._id), entityLabel: p.code,
    summary: `${c.name} paid ₹${p.total} (${p.method}) for ${p.planName}; licence now valid until ${period.to.toISOString().slice(0, 10)}`,
  });
  return p;
}

/** The vendor records a payment received outside the app: { plan, method, reference?, paidOn?, coupon?, extraDiscount?, periodTo?, notes? }. */
export async function recordPayment(clientId: string, body: Record<string, unknown>, user: SessionUser, req: Request) {
  assertControl();
  const c = await loadClient(clientId);
  const errors: Record<string, string> = {};
  const method = text(body.method, 30);
  if (!(MANUAL_METHODS as readonly string[]).includes(method)) errors.method = "How was it paid?";
  const paidOn = text(body.paidOn, 10);
  const paidAt = paidOn ? new Date(`${paidOn}T12:00:00.000Z`) : new Date();
  if (Number.isNaN(paidAt.getTime()) || paidAt.getTime() > Date.now() + DAY) errors.paidOn = "Enter the payment date (not in the future)";
  const extraDiscount = Number(body.extraDiscount || 0);
  if (!(Number.isFinite(extraDiscount) && extraDiscount >= 0)) errors.extraDiscount = "Enter a discount amount";
  let periodTo: Date | null = null;
  if (body.periodTo) {
    periodTo = /^\d{4}-\d{2}-\d{2}$/.test(String(body.periodTo)) ? new Date(`${body.periodTo}T23:59:59.999Z`) : null;
    if (!periodTo || periodTo.getTime() < Date.now()) errors.periodTo = "Enter a date after today";
  }
  if (Object.keys(errors).length) fail(errors);
  const q = await buildQuote(c, { id: body.plan }, text(body.coupon, 30), { online: false, extraDiscount: r2(extraDiscount) });
  const p = await newPayment(c, q, { channel: "Manual", method, reference: text(body.reference, 80) || undefined, notes: text(body.notes, 300) || undefined, recordedByName: user.name });
  const period = periodTo ? { from: new Date(q.quote.periodFrom), to: periodTo } : undefined;
  return paymentOut((await markPaid(p._id, { paidAt }, { req, user, period })).toObject() as Record<string, unknown>);
}

/** Payments list for the Control Panel: ?client=&status=&method=&from=&to=&search=&page= */
export async function listPayments(url: URL) {
  assertControl();
  const { page, limit, skip } = parsePaging(url, 25);
  const filter: Record<string, unknown> = {};
  const client = url.searchParams.get("client");
  if (client && isObjectId(client)) filter.client = new mongoose.Types.ObjectId(client);
  for (const k of ["status", "method", "channel"]) {
    const v = text(url.searchParams.get(k), 30);
    if (v) filter[k] = v;
  }
  const partner = url.searchParams.get("partner");
  if (partner && isObjectId(partner)) filter.partner = new mongoose.Types.ObjectId(partner);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if ((from && /^\d{4}-\d{2}-\d{2}$/.test(from)) || (to && /^\d{4}-\d{2}-\d{2}$/.test(to))) {
    filter.createdAt = { ...(from ? { $gte: new Date(`${from}T00:00:00.000Z`) } : {}), ...(to ? { $lte: new Date(`${to}T23:59:59.999Z`) } : {}) };
  }
  const q = text(url.searchParams.get("search"), 60);
  if (q) filter.$or = ["code", "clientName", "clientCode", "reference", "paymentId", "couponCode"].map((f) => ({ [f]: new RegExp(escapeRegex(q), "i") }));
  const [rows, total, sums] = await Promise.all([
    ControlPayment.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    ControlPayment.countDocuments(filter),
    ControlPayment.aggregate<{ taxable: number; gst: number; total: number; commission: number; commissionDue: number; n: number }>([
      { $match: { ...filter, status: "Paid" } },
      { $group: { _id: null, n: { $sum: 1 }, taxable: { $sum: "$taxable" }, gst: { $sum: "$gst" }, total: { $sum: "$total" }, commission: { $sum: "$commission" }, commissionDue: { $sum: { $cond: ["$commissionPaid", 0, "$commission"] } } } },
    ]),
  ]);
  const s = sums[0];
  return {
    rows: rows.map((p) => paymentOut(p as Record<string, unknown>)),
    totals: { paid: s?.n ?? 0, taxable: r2(s?.taxable ?? 0), gst: r2(s?.gst ?? 0), total: r2(s?.total ?? 0), commission: r2(s?.commission ?? 0), commissionDue: r2(s?.commissionDue ?? 0) },
    pagination: pagination(page, limit, total),
  };
}

/** { action: "sync" | "cancel" | "commission-paid" | "commission-unpaid" } */
export async function paymentAction(id: string, body: Record<string, unknown>, user: SessionUser, req: Request) {
  assertControl();
  if (!isObjectId(id)) throw new ApiError(404, "Payment not found");
  const p = (await ControlPayment.findById(id)) as PaymentDoc | null;
  if (!p) throw new ApiError(404, "Payment not found");
  const action = String(body.action ?? "");
  if (action === "sync") {
    if (p.channel !== "Online") throw new ApiError(409, "Only online payments can be checked with Razorpay");
    return paymentOut((await settleFromRazorpay(p, null, req, user)).toObject() as Record<string, unknown>);
  }
  if (action === "cancel") {
    if (p.status === "Paid") throw new ApiError(409, "A paid payment cannot be cancelled; change the client's expiry instead");
    p.status = "Cancelled";
    await p.save();
    await logActivity({ req, user, action: "update", module: "system", resource: "control_payments", entityId: id, entityLabel: p.code, summary: `Cancelled unpaid payment ${p.code} of ${p.clientName}` });
    return paymentOut(p.toObject() as Record<string, unknown>);
  }
  if (action === "commission-paid" || action === "commission-unpaid") {
    if (p.status !== "Paid" || !p.partner) throw new ApiError(409, "No commission on this payment");
    p.commissionPaid = action === "commission-paid";
    await p.save();
    await logActivity({ req, user, action: "update", module: "system", resource: "control_payments", entityId: id, entityLabel: p.code, summary: `Marked commission of ₹${p.commission} to ${p.partnerName} on ${p.code} as ${p.commissionPaid ? "paid" : "unpaid"}` });
    return paymentOut(p.toObject() as Record<string, unknown>);
  }
  throw new ApiError(400, "Unknown action");
}

export async function invoiceView(id: string, onlyClient?: ClientDocument): Promise<InvoiceView> {
  if (!isObjectId(id)) throw new ApiError(404, "Invoice not found");
  const p = await ControlPayment.findOne({ _id: id, status: "Paid", ...(onlyClient ? { client: onlyClient._id } : {}) }).lean();
  if (!p) throw new ApiError(404, "Invoice not found");
  const c = onlyClient ?? ((await ControlClient.findById(p.client)) as ClientDocument | null);
  const b = (c?.branding ?? {}) as { address?: string; gstin?: string };
  return {
    payment: paymentOut(p as Record<string, unknown>),
    vendor: vendorInfo(),
    customer: { name: c?.name ?? p.clientName ?? "", code: c?.code ?? p.clientCode ?? "", address: b.address ?? null, city: c?.city ?? null, gstin: b.gstin ?? null, contactName: c?.contactName ?? null, phone: c?.contactPhone ?? null, email: c?.contactEmail ?? null },
  };
}

/* ======================= online renewal (called by installations) ======================= */

async function capture(account: ResolvedAccount, payment: RzpPayment) {
  if (payment.status === "authorized") return rzp<RzpPayment>(account.credentials(), "POST", `/payments/${payment.id}/capture`, { amount: payment.amount, currency: payment.currency });
  return payment;
}

/** Ask Razorpay about the order (or use the payment from checkout) and record it when captured. */
async function settleFromRazorpay(p: PaymentDoc, fromCheckout: RzpPayment | null, req: Request, user: SessionUser | null) {
  if (p.status === "Paid" || p.status === "Cancelled") return p;
  const account = await accountById(p.account);
  let payment = fromCheckout;
  if (!payment) {
    const { items } = await rzp<{ items: RzpPayment[] }>(account.credentials(), "GET", `/orders/${p.orderId}/payments`);
    payment = items.find((x) => x.status === "captured") ?? items.find((x) => x.status === "authorized") ?? null;
    if (!payment) {
      const failed = items.find((x) => x.status === "failed");
      if (failed && p.status === "Created") {
        p.set({ status: "Failed", error: failed.error_description || "Payment failed at Razorpay" });
        await p.save();
      }
      return p;
    }
  }
  payment = await capture(account, payment);
  if (payment.status !== "captured") throw new ApiError(409, `Payment is ${payment.status} at Razorpay`);
  if (Math.round(p.total * 100) !== payment.amount) throw new ApiError(409, "The amount paid does not match this order. Contact your vendor.");
  return markPaid(p._id, { paymentId: payment.id, reference: `Razorpay ${payment.id}${payment.method ? ` (${payment.method})` : ""}` }, { req, user });
}

/**
 * Installation (Bearer install token) → { action, … }:
 *   info    { plan?, coupon? }                            plans, payments, and a quote when a plan is given
 *   order   { plan, coupon? }                             Razorpay order on the vendor's account
 *   verify  { orderId | id, paymentId?, signature? }      record a checkout (or re-check an order) → licence
 *   invoice { id }                                        a paid invoice of this client
 */
export async function renewal(body: Record<string, unknown>, req: Request) {
  const c = (await authInstallation(req)) as ClientDocument;
  const action = String(body.action ?? "info");
  if (action === "info") return renewalInfo(c, body);
  if (action === "order") return renewalOrder(c, body);
  if (action === "verify") return renewalVerify(c, body, req);
  if (action === "invoice") return invoiceView(String(body.id ?? ""), c);
  throw new ApiError(400, "Unknown action");
}

async function renewalInfo(c: ClientDocument, body: Record<string, unknown>): Promise<RenewalInfo> {
  const [plans, account, payments] = await Promise.all([
    ControlPlan.find({ active: true, public: true, trial: { $ne: true } }).sort({ sortOrder: 1, price: 1 }).lean(),
    hospitalAccount(),
    ControlPayment.find({ client: c._id, status: { $in: ["Paid", "Created", "Failed"] } }).sort({ createdAt: -1 }).limit(20).lean(),
  ]);
  const planCode = text(body.plan, 20);
  return {
    current: { plan: c.planCode ? { code: c.planCode, name: c.planName ?? "" } : null, trial: !!c.trial, expiresAt: iso(c.expiresAt) },
    plans: plans.map((p) => ({ code: p.code, name: p.name, description: p.description ?? null, features: p.features ?? [], modules: (p.modules ?? []).filter(isModuleKey), durationDays: p.durationDays, price: p.price, gstPct: p.gstPct ?? 0, maxUsers: p.maxUsers ?? 0 })),
    online: { enabled: !!account, mode: account?.mode ?? null },
    quote: planCode ? (await buildQuote(c, { code: planCode }, text(body.coupon, 30), { online: true })).quote : null,
    payments: payments.filter((p) => p.status === "Paid" || Date.now() - (p.createdAt?.getTime() ?? 0) < 7 * DAY).map((p) => paymentOut(p as Record<string, unknown>)),
    vendor: vendorInfo(),
  };
}

async function renewalOrder(c: ClientDocument, body: Record<string, unknown>): Promise<RenewalOrder> {
  if (c.status === "Suspended") throw new ApiError(403, "This licence is suspended. Contact your vendor.");
  const account = await hospitalAccount();
  if (!account) throw new ApiError(409, "Online payment is not available right now. Please contact your vendor to renew.");
  const q = await buildQuote(c, { code: text(body.plan, 20) }, text(body.coupon, 30), { online: true });
  if (q.quote.total < 1) throw new ApiError(422, "Nothing to pay. Contact your vendor to apply this coupon.");
  const p = await newPayment(c, q, { channel: "Online", method: "Razorpay", account: account.id, keyId: account.keyId, mode: account.mode });
  let order: RzpOrder;
  try {
    order = await rzp<RzpOrder>(account.credentials(), "POST", "/orders", {
      amount: Math.round(q.quote.total * 100), currency: "INR", receipt: p.code, notes: { client: c.code, hospital: c.name.slice(0, 100), plan: q.plan.code },
    });
  } catch (e) {
    await ControlPayment.deleteOne({ _id: p._id });
    throw e;
  }
  p.orderId = order.id;
  await p.save();
  const vendor = vendorInfo();
  return {
    paymentId: String(p._id), keyId: account.keyId, orderId: order.id, amount: order.amount, currency: order.currency,
    name: vendor.name, description: `${q.plan.name} · ${durationLabel(q.plan.durationDays)} · ${c.code}`,
    prefill: { name: c.contactName ?? c.name, email: c.contactEmail ?? "", contact: c.contactPhone ?? "" }, quote: q.quote,
  };
}

async function renewalVerify(c: ClientDocument, body: Record<string, unknown>, req: Request) {
  const id = text(body.id, 40);
  const p = (await ControlPayment.findOne(isObjectId(id) ? { _id: id, client: c._id } : { orderId: text(body.orderId, 40), client: c._id })) as PaymentDoc | null;
  if (!p || !p.orderId) throw new ApiError(404, "This payment was not found");
  const orderId = p.orderId;
  let fromCheckout: RzpPayment | null = null;
  const paymentId = text(body.paymentId, 40);
  if (paymentId && p.status !== "Paid") {
    if (!/^pay_[A-Za-z0-9]+$/.test(paymentId)) throw new ApiError(400, "Invalid payment id");
    const account = await accountById(p.account);
    if (!signatureValid(account.credentials().secret, orderId, paymentId, String(body.signature ?? ""))) throw new ApiError(400, "Razorpay signature check failed — the payment was not recorded");
    fromCheckout = await rzp<RzpPayment>(account.credentials(), "GET", `/payments/${paymentId}`);
    if (fromCheckout.order_id !== orderId) throw new ApiError(400, "Payment does not belong to this order");
  }
  const settled = await settleFromRazorpay(p, fromCheckout, req, null);
  const fresh = (await ControlClient.findById(c._id)) as ClientDocument;
  return { payment: paymentOut(settled.toObject() as Record<string, unknown>), licence: payload(fresh) };
}

/* ======================= free trial & website enquiries (public) ======================= */

/**
 * Setup screen without a licence key: { hospitalName, contactName, phone, email, city?, referralCode?, installationId, host, version }
 * → a client on the trial plan, bound to this installation, plus a lead for the vendor to follow up.
 */
export async function startTrial(body: Record<string, unknown>, req: Request) {
  assertControl();
  rateLimit(`trial:${clientIp(req)}`, 5, 3_600_000);
  const errors: Record<string, string> = {};
  const hospitalName = text(body.hospitalName, 120);
  const contactName = text(body.contactName, 80);
  const phone = phoneOf(body.phone);
  const email = text(body.email, 120).toLowerCase();
  const city = text(body.city, 80);
  const referralCode = text(body.referralCode, 20).toUpperCase();
  const installationId = text(body.installationId, 64);
  if (hospitalName.length < 3) errors.hospitalName = "Enter the hospital's name";
  if (contactName.length < 2) errors.contactName = "Enter your name";
  if (!/^\+?\d{10,15}$/.test(phone)) errors.phone = "Enter a mobile number";
  if (!isValidEmail(email)) errors.email = "Enter a valid email";
  if (!/^[a-f0-9-]{16,64}$/.test(installationId)) throw new ApiError(400, "Invalid installation id");
  if (Object.keys(errors).length) fail(errors);

  const plan = (await ControlPlan.findOne({ trial: true, active: true }).lean()) as PlanLean | null;
  if (!plan) throw new ApiError(404, "A free trial is not offered right now. Ask your vendor for a licence key.");
  const partner = referralCode ? await ControlPartner.findOne({ referralCode, active: true }).select("name").lean() : null;
  if (referralCode && !partner) fail({ referralCode: "This referral code is not valid" });
  const existing = await ControlClient.findOne({ $or: [{ contactEmail: email }, { contactPhone: phone }, { installationId }] }).select("code").lean();
  if (existing) throw new ApiError(409, `This email, mobile or computer already has an account (${existing.code}). Use the licence key from your vendor, or contact them.`);

  const now = new Date();
  const expiresAt = new Date(now.getTime() + plan.durationDays * DAY);
  expiresAt.setUTCHours(23, 59, 59, 999);
  const lead = await ControlLead.create({
    code: await newLeadCode(), hospitalName, contactName, phone, email, city: city || undefined, source: "Free trial", status: "Trial", interestedPlan: undefined,
    partner: partner?._id, nextFollowUp: new Date(now.getTime() + 3 * DAY), createdByName: "Free trial signup",
  });
  const { c, licenceKey } = await insertClient({
    name: hospitalName, contactName, contactPhone: phone, contactEmail: email, city: city || undefined,
    modules: plan.modules, graceDays: plan.graceDays, maxUsers: plan.maxUsers, plan: plan._id, planCode: plan.code, planName: plan.name, trial: true, expiresAt,
    source: "Free trial", partner: partner?._id, lead: lead._id, syncEnabled: true,
  }, "Free trial signup");
  const installToken = await bindInstallation(c, installationId, body, req);
  await logActivity({
    req, user: null, actorEmail: email, action: "create", module: "system", resource: "control_clients", entityId: String(c._id), entityLabel: c.code,
    summary: `Free trial started: ${hospitalName} (${contactName}, ${phone}) on ${plan.name} until ${expiresAt.toISOString().slice(0, 10)}${partner ? `, referred by ${partner.name}` : ""}`,
  });
  return { licence: payload(c), installToken, licenceKey };
}

/** Website "request a demo" form: { hospitalName, contactName, phone, email?, city?, beds?, plan?, message?, company (honeypot) }. */
export async function createEnquiry(body: Record<string, unknown>, req: Request) {
  assertControl();
  rateLimit(`enquiry:${clientIp(req)}`, 5, 3_600_000);
  if (text(body.company, 10)) return { received: true };
  const errors: Record<string, string> = {};
  const hospitalName = text(body.hospitalName, 120);
  const contactName = text(body.contactName, 80);
  const phone = phoneOf(body.phone);
  const email = text(body.email, 120).toLowerCase();
  if (hospitalName.length < 3) errors.hospitalName = "Enter the hospital's name";
  if (contactName.length < 2) errors.contactName = "Enter your name";
  if (!/^\+?\d{10,15}$/.test(phone)) errors.phone = "Enter a mobile number";
  if (email && !isValidEmail(email)) errors.email = "Enter a valid email";
  if (Object.keys(errors).length) fail(errors);
  const beds = Number(body.beds);
  const plan = text(body.plan, 20) ? await ControlPlan.findOne({ code: text(body.plan, 20).toUpperCase(), active: true }).select("_id").lean() : null;
  const lead = await ControlLead.create({
    code: await newLeadCode(), hospitalName, contactName, phone, email: email || undefined, city: text(body.city, 80) || undefined,
    beds: Number.isInteger(beds) && beds > 0 && beds < 10_000 ? beds : undefined, source: "Website", status: "New", interestedPlan: plan?._id,
    nextFollowUp: new Date(), notes: text(body.message, 1000) || undefined, createdByName: "Website enquiry",
  });
  await logActivity({ req, user: null, actorEmail: email || phone, action: "create", module: "system", resource: "control_leads", entityId: String(lead._id), entityLabel: lead.code, summary: `Website enquiry from ${hospitalName} (${contactName}, ${phone})` });
  return { received: true };
}
