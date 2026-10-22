import "server-only";
import mongoose, { type Model } from "mongoose";
import { ApiError, escapeRegex, pagination, parsePaging } from "./api";
import { logActivity } from "./audit";
import { assertControl, fail, text } from "./control";
import { COUPON_KINDS, LEAD_SOURCES, LEAD_STATUSES, PARTNER_TYPES, r2 } from "./control-shared";
import type { SessionUser } from "./session";
import { isObjectId, isValidEmail } from "./validation";
import { nextSerial } from "@/models/Counter";
import { ControlClient, ControlCoupon, ControlLead, ControlPartner, ControlPayment, ControlPlan } from "@/models/control";

/**
 * Control Panel: the vendor's own sales pipeline — hospitals enquiring or on
 * a free trial (leads), resellers and referrers who bring them (partners,
 * with commission on what their hospitals pay), and coupon codes for plans.
 */

type Doc = Record<string, unknown> & { _id: mongoose.Types.ObjectId };

const DAY = 86_400_000;
const OPEN_LEADS = { status: { $nin: ["Won", "Lost"] as ("Won" | "Lost")[] } };
const iso = (d: unknown) => (d instanceof Date ? d.toISOString() : null);
const day = (d: unknown) => (d instanceof Date ? d.toISOString().slice(0, 10) : null);
const ref = (v: unknown, label = "name") => (v && typeof v === "object" && "_id" in v ? { id: String((v as Doc)._id), name: String((v as Doc)[label] ?? "") } : null);

export const newLeadCode = async () => `L${String(await nextSerial("CONTROL_LEAD")).padStart(5, "0")}`;
export const phoneOf = (v: unknown) => text(v, 24).replace(/[^\d+]/g, "");

function endOfToday() {
  const d = new Date();
  d.setUTCHours(23, 59, 59, 999);
  return d;
}

/** "YYYY-MM-DD" → Date (end of that day with `end`); "" → null; anything else → undefined (invalid). */
function parseDay(v: unknown, end = false): Date | null | undefined {
  if (v === "" || v === null || v === undefined) return null;
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
  const d = new Date(`${v}T${end ? "23:59:59.999" : "00:00:00.000"}Z`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

async function exists(model: Model<never> | Model<unknown>, id: unknown) {
  return isObjectId(id) && !!(await (model as Model<unknown>).exists({ _id: id }));
}

/* ======================= resources ======================= */

interface Spec {
  model: Model<unknown>;
  label: string;
  search: string[];
  sort: Record<string, 1 | -1>;
  populate?: { path: string; select: string }[];
  /** Query-string filters allowed on the list: name → accepted values. */
  filters: Record<string, readonly string[]>;
  parse: (body: Record<string, unknown>, partial: boolean, id?: string) => Promise<Record<string, unknown>>;
  out: (d: Doc) => Record<string, unknown>;
  newCode?: () => Promise<string>;
  /** Why a record cannot be deleted, if it cannot. */
  inUse?: (id: string) => Promise<string | null>;
  labelOf: (d: Doc) => string;
}

function collector(body: Record<string, unknown>, partial: boolean) {
  const errors: Record<string, string> = {};
  const set: Record<string, unknown> = {};
  const has = (k: string) => !partial || k in body;
  const str = (k: string, max: number, opts: { required?: string; min?: number } = {}) => {
    if (!has(k)) return;
    const v = text(body[k], max);
    if (opts.required && v.length < (opts.min ?? 1)) errors[k] = opts.required;
    set[k] = v || undefined;
  };
  const oneOf = (k: string, values: readonly string[], fallback?: string) => {
    if (!has(k)) return;
    const v = text(body[k], 40) || fallback;
    if (v && !values.includes(v)) errors[k] = "Choose one of the options";
    set[k] = v || undefined;
  };
  const num = (k: string, min: number, max: number, opts: { int?: boolean; message?: string; fallback?: number } = {}) => {
    if (!has(k)) return;
    const raw = body[k];
    if ((raw === "" || raw === null || raw === undefined) && opts.fallback === undefined) return void (set[k] = undefined);
    const n = raw === "" || raw === null || raw === undefined ? opts.fallback! : Number(raw);
    if (!Number.isFinite(n) || n < min || n > max || (opts.int && !Number.isInteger(n))) errors[k] = opts.message ?? `Between ${min} and ${max}`;
    set[k] = n;
  };
  const date = (k: string, end = false) => {
    if (!has(k)) return;
    const d = parseDay(body[k], end);
    if (d === undefined) errors[k] = "Enter a valid date";
    set[k] = d ?? undefined;
  };
  const bool = (k: string, fallback: boolean) => {
    if (has(k)) set[k] = typeof body[k] === "boolean" ? body[k] : fallback;
  };
  const idOf = async (k: string, model: Model<unknown>, message: string) => {
    if (!has(k)) return;
    const v = body[k];
    if (v === "" || v === null || v === undefined) return void (set[k] = undefined);
    if (!(await exists(model, v))) errors[k] = message;
    set[k] = v;
  };
  return { errors, set, has, str, oneOf, num, date, bool, idOf };
}

const SPECS: Record<string, Spec> = {
  leads: {
    model: ControlLead as Model<unknown>,
    label: "lead",
    search: ["hospitalName", "contactName", "phone", "email", "city", "code"],
    sort: { createdAt: -1 },
    populate: [{ path: "interestedPlan", select: "name" }, { path: "partner", select: "name" }, { path: "client", select: "code name" }],
    filters: { status: LEAD_STATUSES, source: LEAD_SOURCES },
    newCode: newLeadCode,
    labelOf: (d) => `${d.code} ${d.hospitalName}`,
    async parse(body, partial) {
      const c = collector(body, partial);
      c.str("hospitalName", 120, { required: "Enter the hospital's name", min: 2 });
      c.str("contactName", 80);
      if (c.has("phone")) {
        const phone = phoneOf(body.phone);
        if (phone && !/^\+?\d{8,15}$/.test(phone)) c.errors.phone = "Enter a valid phone number";
        c.set.phone = phone || undefined;
      }
      if (c.has("email")) {
        const email = text(body.email, 120).toLowerCase();
        if (email && !isValidEmail(email)) c.errors.email = "Enter a valid email";
        c.set.email = email || undefined;
      }
      c.str("city", 80);
      c.num("beds", 0, 10_000, { int: true, message: "Number of beds" });
      c.oneOf("source", LEAD_SOURCES, "Other");
      c.oneOf("status", LEAD_STATUSES, "New");
      await c.idOf("interestedPlan", ControlPlan as Model<unknown>, "Plan not found");
      await c.idOf("partner", ControlPartner as Model<unknown>, "Partner not found");
      c.date("nextFollowUp");
      c.str("notes", 1000);
      c.str("lostReason", 200);
      if (c.set.status === "Won") c.set.wonAt = new Date();
      if (Object.keys(c.errors).length) fail(c.errors);
      return c.set;
    },
    out: (d) => ({
      id: String(d._id), code: d.code, hospitalName: d.hospitalName, contactName: d.contactName ?? null, phone: d.phone ?? null, email: d.email ?? null, city: d.city ?? null,
      beds: d.beds ?? null, source: d.source, status: d.status, interestedPlan: ref(d.interestedPlan), partner: ref(d.partner),
      client: d.client && typeof d.client === "object" ? { id: String((d.client as Doc)._id), code: String((d.client as Doc).code), name: String((d.client as Doc).name) } : null,
      nextFollowUp: day(d.nextFollowUp), notes: d.notes ?? null, lostReason: d.lostReason ?? null, wonAt: iso(d.wonAt), createdAt: iso(d.createdAt), createdByName: d.createdByName ?? null,
      overdue: d.nextFollowUp instanceof Date && d.nextFollowUp.getTime() <= endOfToday().getTime() && !["Won", "Lost"].includes(String(d.status)),
    }),
    inUse: async (id) => ((await ControlClient.exists({ lead: id })) ? "This lead became a client; mark it Won or Lost instead" : null),
  },

  partners: {
    model: ControlPartner as Model<unknown>,
    label: "partner",
    search: ["name", "contactName", "phone", "email", "city", "referralCode", "code"],
    sort: { name: 1 },
    filters: { active: ["true", "false"], partnerType: PARTNER_TYPES },
    newCode: async () => `P${String(await nextSerial("CONTROL_PARTNER")).padStart(3, "0")}`,
    labelOf: (d) => `${d.code} ${d.name}`,
    async parse(body, partial, id) {
      const c = collector(body, partial);
      c.str("name", 120, { required: "Enter the partner's name", min: 2 });
      c.oneOf("partnerType", PARTNER_TYPES, "Referral");
      c.str("contactName", 80);
      if (c.has("phone")) c.set.phone = phoneOf(body.phone) || undefined;
      if (c.has("email")) {
        const email = text(body.email, 120).toLowerCase();
        if (email && !isValidEmail(email)) c.errors.email = "Enter a valid email";
        c.set.email = email || undefined;
      }
      c.str("city", 80);
      c.num("commissionPct", 0, 100, { fallback: 10, message: "0–100 %" });
      if (c.has("referralCode")) {
        let code = text(body.referralCode, 20).toUpperCase();
        if (!code && !partial) code = `${text(body.name, 40).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) || "REF"}${Math.floor(100 + Math.random() * 900)}`;
        if (!/^[A-Z0-9]{3,20}$/.test(code)) c.errors.referralCode = "3–20 letters and digits";
        else if (await ControlPartner.exists({ referralCode: code, ...(id ? { _id: { $ne: id } } : {}) })) c.errors.referralCode = "Already used by another partner";
        c.set.referralCode = code;
      }
      c.bool("active", true);
      c.str("notes", 1000);
      if (Object.keys(c.errors).length) fail(c.errors);
      return c.set;
    },
    out: (d) => ({
      id: String(d._id), code: d.code, name: d.name, partnerType: d.partnerType, contactName: d.contactName ?? null, phone: d.phone ?? null, email: d.email ?? null, city: d.city ?? null,
      commissionPct: d.commissionPct ?? 0, referralCode: d.referralCode, active: d.active !== false, notes: d.notes ?? null, createdAt: iso(d.createdAt),
    }),
    async inUse(id) {
      const [clients, payments] = await Promise.all([ControlClient.exists({ partner: id }), ControlPayment.exists({ partner: id })]);
      return clients || payments ? "This partner has clients or sales; deactivate it instead" : null;
    },
  },

  coupons: {
    model: ControlCoupon as Model<unknown>,
    label: "coupon",
    search: ["code", "description"],
    sort: { createdAt: -1 },
    populate: [{ path: "plans", select: "name" }, { path: "partner", select: "name" }],
    filters: { active: ["true", "false"] },
    labelOf: (d) => String(d.code),
    async parse(body, partial, id) {
      const c = collector(body, partial);
      if (c.has("code")) {
        const code = text(body.code, 20).toUpperCase();
        if (!/^[A-Z0-9_-]{3,20}$/.test(code)) c.errors.code = "3–20 letters, digits, - or _";
        else if (await ControlCoupon.exists({ code, ...(id ? { _id: { $ne: id } } : {}) })) c.errors.code = "This code already exists";
        c.set.code = code;
      }
      c.str("description", 120);
      c.oneOf("kind", COUPON_KINDS, "Percent");
      c.num("value", 0.01, 10_000_000, { message: "Enter the discount" });
      c.date("validFrom");
      c.date("validTo", true);
      c.num("maxUses", 0, 1_000_000, { int: true, fallback: 0, message: "0 (unlimited) or more" });
      if (c.has("plans")) {
        const ids = Array.isArray(body.plans) ? [...new Set(body.plans.map(String))] : [];
        if (!ids.every(isObjectId) || (await ControlPlan.countDocuments({ _id: { $in: ids } })) !== ids.length) c.errors.plans = "Unknown plan selected";
        c.set.plans = ids;
      }
      await c.idOf("partner", ControlPartner as Model<unknown>, "Partner not found");
      c.bool("active", true);
      const kind = c.set.kind ?? (id ? (await ControlCoupon.findById(id).select("kind").lean())?.kind : undefined);
      if (kind === "Percent" && typeof c.set.value === "number" && c.set.value > 100) c.errors.value = "At most 100 %";
      if (c.set.validFrom instanceof Date && c.set.validTo instanceof Date && c.set.validTo < c.set.validFrom) c.errors.validTo = "Must be after Valid from";
      if (Object.keys(c.errors).length) fail(c.errors);
      return c.set;
    },
    out: (d) => {
      const now = Date.now();
      const status = d.active === false ? "Inactive"
        : d.validTo instanceof Date && d.validTo.getTime() < now ? "Expired"
        : d.validFrom instanceof Date && d.validFrom.getTime() > now ? "Scheduled"
        : Number(d.maxUses) > 0 && Number(d.used) >= Number(d.maxUses) ? "Used up" : "Active";
      return {
        id: String(d._id), code: d.code, description: d.description ?? null, kind: d.kind, value: d.value, validFrom: day(d.validFrom), validTo: day(d.validTo),
        maxUses: d.maxUses ?? 0, used: d.used ?? 0, plans: Array.isArray(d.plans) ? d.plans.map((p) => ref(p)).filter(Boolean) : [], partner: ref(d.partner), active: d.active !== false, status,
      };
    },
    inUse: async (id) => ((await ControlPayment.exists({ coupon: id })) ? "This coupon has been used; deactivate it instead" : null),
  },
};

function spec(resource: string) {
  assertControl();
  const s = SPECS[resource];
  if (!s) throw new ApiError(404, "Unknown resource");
  return s;
}

export async function listSales(resource: string, url: URL) {
  const s = spec(resource);
  const { page, limit, skip } = parsePaging(url, 25);
  const filter: Record<string, unknown> = {};
  const q = text(url.searchParams.get("search"), 60);
  if (q) filter.$or = s.search.map((f) => ({ [f]: new RegExp(escapeRegex(q), "i") }));
  for (const [k, values] of Object.entries(s.filters)) {
    const v = url.searchParams.get(k);
    if (v && values.includes(v)) filter[k] = v === "true" ? true : v === "false" ? false : v;
  }
  if (resource === "leads" && url.searchParams.get("due") === "1") Object.assign(filter, OPEN_LEADS, { nextFollowUp: { $lte: endOfToday() } });
  if (resource === "leads" && url.searchParams.get("open") === "1") Object.assign(filter, OPEN_LEADS);
  let query = s.model.find(filter).sort(resource === "leads" && url.searchParams.get("due") === "1" ? { nextFollowUp: 1 } : s.sort).skip(skip).limit(limit);
  for (const p of s.populate ?? []) query = query.populate(p);
  const [rows, total] = await Promise.all([query.lean<Doc[]>(), s.model.countDocuments(filter)]);
  let out = rows.map(s.out);
  if (resource === "partners") out = await withPartnerStats(out);
  return { rows: out, pagination: pagination(page, limit, total) };
}

/** Leads, clients, sales and commission per partner. */
async function withPartnerStats(rows: Record<string, unknown>[]) {
  const ids = rows.map((r) => new mongoose.Types.ObjectId(String(r.id)));
  const [leads, clients, sales] = await Promise.all([
    ControlLead.aggregate<{ _id: unknown; n: number }>([{ $match: { partner: { $in: ids } } }, { $group: { _id: "$partner", n: { $sum: 1 } } }]),
    ControlClient.aggregate<{ _id: unknown; n: number }>([{ $match: { partner: { $in: ids } } }, { $group: { _id: "$partner", n: { $sum: 1 } } }]),
    ControlPayment.aggregate<{ _id: unknown; sales: number; commission: number; due: number }>([
      { $match: { partner: { $in: ids }, status: "Paid" } },
      { $group: { _id: "$partner", sales: { $sum: "$taxable" }, commission: { $sum: "$commission" }, due: { $sum: { $cond: ["$commissionPaid", 0, "$commission"] } } } },
    ]),
  ]);
  const by = <T extends { _id: unknown }>(a: T[]) => new Map(a.map((x) => [String(x._id), x]));
  const [l, c, s] = [by(leads), by(clients), by(sales)];
  return rows.map((r) => ({ ...r, leads: l.get(String(r.id))?.n ?? 0, clients: c.get(String(r.id))?.n ?? 0, sales: r2(s.get(String(r.id))?.sales ?? 0), commission: r2(s.get(String(r.id))?.commission ?? 0), commissionDue: r2(s.get(String(r.id))?.due ?? 0) }));
}

async function loadOut(s: Spec, id: string) {
  let query = s.model.findById(id);
  for (const p of s.populate ?? []) query = query.populate(p);
  const d = await query.lean<Doc>();
  if (!d) throw new ApiError(404, `This ${s.label} was not found`);
  return s.out(d);
}

export async function createSales(resource: string, body: Record<string, unknown>, user: SessionUser, req: Request) {
  const s = spec(resource);
  const set = await s.parse(body, false);
  if (s.newCode) set.code = await s.newCode();
  if (resource === "leads") set.createdByName = user.name;
  const doc = (await s.model.create(set)) as unknown as Doc;
  await logActivity({ req, user, action: "create", module: "system", resource: `control_${resource}`, entityId: String(doc._id), entityLabel: s.labelOf(doc), summary: `Added ${s.label} ${s.labelOf(doc)}` });
  return loadOut(s, String(doc._id));
}

export async function updateSales(resource: string, id: string, body: Record<string, unknown>, user: SessionUser, req: Request) {
  const s = spec(resource);
  if (!isObjectId(id)) throw new ApiError(404, `This ${s.label} was not found`);
  const doc = await s.model.findById(id);
  if (!doc) throw new ApiError(404, `This ${s.label} was not found`);
  const set = await s.parse(body, true, id);
  const d = doc as unknown as mongoose.Document & Doc;
  if (resource === "leads" && set.status !== "Won") delete set.wonAt;
  if (resource === "leads" && set.status === "Won" && d.get("status") === "Won") delete set.wonAt;
  const changed = Object.keys(set).filter((k) => JSON.stringify(set[k] ?? null) !== JSON.stringify(d.get(k) ?? null));
  if (changed.length) {
    d.set(set);
    await d.save();
    await logActivity({ req, user, action: "update", module: "system", resource: `control_${resource}`, entityId: id, entityLabel: s.labelOf(d.toObject() as Doc), changedFields: changed, summary: `Updated ${s.label} ${s.labelOf(d.toObject() as Doc)}: ${changed.join(", ")}` });
  }
  return loadOut(s, id);
}

export async function deleteSales(resource: string, id: string, user: SessionUser, req: Request) {
  const s = spec(resource);
  if (!isObjectId(id)) throw new ApiError(404, `This ${s.label} was not found`);
  const why = await s.inUse?.(id);
  if (why) throw new ApiError(409, why);
  const d = await s.model.findByIdAndDelete(id).lean<Doc>();
  if (!d) throw new ApiError(404, `This ${s.label} was not found`);
  await logActivity({ req, user, action: "delete", module: "system", resource: `control_${resource}`, entityId: id, entityLabel: s.labelOf(d), summary: `Deleted ${s.label} ${s.labelOf(d)}` });
  return { deleted: true };
}

/** Small lists for pickers in the Control Panel's forms. */
export async function salesOptions() {
  assertControl();
  const [plans, partners] = await Promise.all([
    ControlPlan.find().sort({ sortOrder: 1, price: 1 }).select("code name modules durationDays price gstPct graceDays maxUsers trial active").lean(),
    ControlPartner.find({ active: true }).sort({ name: 1 }).select("code name referralCode commissionPct").lean(),
  ]);
  return {
    plans: plans.map((p) => ({ id: String(p._id), code: p.code, name: p.name, modules: p.modules ?? [], durationDays: p.durationDays, price: p.price, gstPct: p.gstPct ?? 0, graceDays: p.graceDays ?? 15, maxUsers: p.maxUsers ?? 0, trial: !!p.trial, active: p.active !== false })),
    partners: partners.map((p) => ({ id: String(p._id), code: p.code, name: p.name, referralCode: p.referralCode, commissionPct: p.commissionPct ?? 0 })),
  };
}

/* ======================= overview ======================= */

/** ?from=&to= (default: the last 30 days). Pipeline, trials, revenue, renewals due and partner results. */
export async function salesOverview(url: URL) {
  assertControl();
  const to = parseDay(url.searchParams.get("to"), true) ?? endOfToday();
  const from = parseDay(url.searchParams.get("from")) ?? new Date(to.getTime() - 30 * DAY + 1);
  if (from > to) throw new ApiError(422, "From date must be before To date");
  const range = { $gte: from, $lte: to };
  const now = new Date();

  const [leads, paid, activePaid, activeTrials, renewals, due, dueCount, partnerSales, coupons] = await Promise.all([
    ControlLead.find({ createdAt: range }).select("status source").lean(),
    ControlPayment.find({ status: "Paid", paidAt: range }).select("total taxable gst planName channel commission").lean(),
    ControlClient.countDocuments({ status: "Active", trial: { $ne: true }, plan: { $exists: true }, expiresAt: { $gt: now } }),
    ControlClient.countDocuments({ status: "Active", trial: true, expiresAt: { $gt: now } }),
    ControlClient.find({ status: "Active", expiresAt: { $gte: new Date(now.getTime() - 30 * DAY), $lte: new Date(now.getTime() + 30 * DAY) } })
      .sort({ expiresAt: 1 }).limit(50).select("code name city contactName contactPhone contactEmail planName trial expiresAt lastSeenAt").lean(),
    ControlLead.find({ ...OPEN_LEADS, nextFollowUp: { $lte: endOfToday() } }).sort({ nextFollowUp: 1 }).limit(15).select("code hospitalName contactName phone status nextFollowUp source").lean(),
    ControlLead.countDocuments({ ...OPEN_LEADS, nextFollowUp: { $lte: endOfToday() } }),
    ControlPayment.aggregate<{ _id: unknown; sales: number; n: number; commission: number }>([
      { $match: { status: "Paid", paidAt: range, partner: { $exists: true } } },
      { $group: { _id: "$partner", name: { $first: "$partnerName" }, sales: { $sum: "$taxable" }, n: { $sum: 1 }, commission: { $sum: "$commission" } } },
      { $sort: { sales: -1 } },
      { $limit: 10 },
    ]),
    ControlCoupon.find({ used: { $gt: 0 } }).sort({ used: -1 }).limit(10).select("code kind value used maxUses").lean(),
  ]);

  const won = (rows: { status?: string | null }[]) => rows.filter((l) => l.status === "Won").length;
  const pct = (a: number, b: number) => (b ? r2((a / b) * 100) : null);
  const trials = leads.filter((l) => l.source === "Free trial");
  const byPlan = new Map<string, { plan: string; payments: number; revenue: number }>();
  for (const p of paid) {
    const row = byPlan.get(p.planName ?? "—") ?? { plan: p.planName ?? "—", payments: 0, revenue: 0 };
    row.payments++;
    row.revenue = r2(row.revenue + (p.taxable ?? 0));
    byPlan.set(row.plan, row);
  }

  return {
    from: day(from),
    to: day(to),
    totals: {
      leads: leads.length,
      won: won(leads),
      conversionPct: pct(won(leads), leads.length),
      trials: trials.length,
      trialConversionPct: pct(won(trials), trials.length),
      revenue: r2(paid.reduce((s, p) => s + (p.taxable ?? 0), 0)),
      collected: r2(paid.reduce((s, p) => s + (p.total ?? 0), 0)),
      gst: r2(paid.reduce((s, p) => s + (p.gst ?? 0), 0)),
      payments: paid.length,
      onlinePayments: paid.filter((p) => p.channel === "Online").length,
      commission: r2(paid.reduce((s, p) => s + (p.commission ?? 0), 0)),
      activePaid,
      activeTrials,
      followUpsDue: dueCount,
    },
    funnel: LEAD_STATUSES.map((status) => ({ status, count: leads.filter((l) => l.status === status).length })),
    bySource: LEAD_SOURCES.map((source) => {
      const rows = leads.filter((l) => l.source === source);
      return { source, leads: rows.length, won: won(rows), conversionPct: pct(won(rows), rows.length) };
    }).filter((s) => s.leads > 0).sort((a, b) => b.leads - a.leads),
    byPlan: [...byPlan.values()].sort((a, b) => b.revenue - a.revenue),
    renewals: renewals.map((c) => ({
      id: String(c._id), code: c.code, name: c.name, city: c.city ?? null, contactName: c.contactName ?? null, phone: c.contactPhone ?? null, email: c.contactEmail ?? null,
      plan: c.planName ?? null, trial: !!c.trial, expiresAt: iso(c.expiresAt), daysLeft: c.expiresAt ? Math.ceil((c.expiresAt.getTime() - now.getTime()) / DAY) : null, lastSeenAt: iso(c.lastSeenAt),
    })),
    due: due.map((l) => ({ id: String(l._id), code: l.code, hospitalName: l.hospitalName, contactName: l.contactName ?? null, phone: l.phone ?? null, status: l.status, source: l.source, nextFollowUp: day(l.nextFollowUp) })),
    partners: partnerSales.map((p) => ({ id: String(p._id), name: String((p as unknown as { name?: string }).name ?? ""), payments: p.n, sales: r2(p.sales), commission: r2(p.commission) })),
    coupons: coupons.map((c) => ({ code: c.code, kind: c.kind, value: c.value, used: c.used ?? 0, maxUses: c.maxUses ?? 0 })),
  };
}
