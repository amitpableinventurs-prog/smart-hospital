import "server-only";
import mongoose, { Types } from "mongoose";
import { ApiError, escapeRegex, pagination, parsePaging } from "./api";
import { logActivity } from "./audit";
import { hospitalBill, payerSplit, r2 } from "./billing-math";
import { approvedPreauthPayer, linkPreauthBill, raiseClaimForBill } from "./insurance-claims";
import { BILL_PAYMENT_MODES, BILL_TYPES, DOCTOR_FEE_TYPES, GST_RATES, PAYER_TYPES, RATE_PLANS, SERVICE_CATEGORIES } from "./modules";
import type { SessionUser } from "./session";
import { isObjectId } from "./validation";
import { nextCode } from "@/models/Counter";
import { Bill, DayClose, RECEIPT_KINDS, Shift, type BillDoc } from "@/models/billing";
import { LabOrder } from "@/models/laboratory";
import { Sale } from "@/models/pharmacy";
import { getRecordModel } from "@/models/records";

type Doc = Record<string, unknown> & { _id: Types.ObjectId };
type BDoc = mongoose.HydratedDocument<BillDoc>;
type LineDoc = BDoc["lines"][number];
type ReceiptKind = (typeof RECEIPT_KINDS)[number];

const model = (m: string, r: string) => getRecordModel(m, r)!;
const Services = () => model("billing", "services");
const Packages = () => model("billing", "packages");
const Rates = () => model("billing", "rates");
const Corporates = () => model("billing", "corporates");
const Payouts = () => model("billing", "doctor_payouts");
const Patients = () => model("patients", "patients");
const Doctors = () => model("doctors", "doctors");
const Visits = () => model("opd_ipd", "visits");
const Admissions = () => model("opd_ipd", "admissions");
const Providers = () => model("insurance", "providers");

const MAX_LINES = 300;
const MAX_SPLITS = 5;
const DAY = 86_400_000;

/* ======================= helpers ======================= */

export function todayUtc() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function parseDay(v: unknown): Date | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function num(v: unknown, fallback = NaN) {
  if (v === "" || v === null || v === undefined) return fallback;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function text(v: unknown, max: number) {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function fail(errors: Record<string, string>, message = "Please correct the highlighted fields"): never {
  throw new ApiError(422, message, errors);
}

const sameId = (a: unknown, b: unknown) => !!a && !!b && String(a) === String(b);

function ageYears(dob: unknown, at = new Date()) {
  if (!(dob instanceof Date)) return undefined;
  let age = at.getUTCFullYear() - dob.getUTCFullYear();
  const m = at.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && at.getUTCDate() < dob.getUTCDate())) age--;
  return Math.max(0, age);
}

/** Dates → ISO strings, ObjectIds → strings, recursively (for JSON responses). */
function plain(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (v instanceof Types.ObjectId) return String(v);
  if (Array.isArray(v)) return v.map(plain);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      if (k === "__v") continue;
      out[k === "_id" ? "id" : k] = plain(x);
    }
    return out;
  }
  return v;
}

export function hospitalInfo() {
  return {
    name: process.env.HOSPITAL_NAME || "MediCare Hospital",
    address: process.env.HOSPITAL_ADDRESS || "",
    phone: process.env.HOSPITAL_PHONE || "",
    gstin: process.env.HOSPITAL_GSTIN || "",
  };
}

/** Days of stay for per-day charges: admission day to discharge (or today), at least one. */
function stayDays(from?: Date | null, to?: Date | null) {
  if (!(from instanceof Date)) return 1;
  const end = to instanceof Date ? to : todayUtc();
  return Math.max(1, Math.round((end.getTime() - from.getTime()) / DAY));
}

const live = (b: { lines: LineDoc[] }) => b.lines.filter((l) => l.status !== "Cancelled");
const counted = (r: { splits: { amount: number; recon?: string | null }[] }) => r2(r.splits.filter((s) => s.recon !== "Bounced").reduce((s, x) => s + x.amount, 0));

/**
 * Re-derive every total, share, due and status from the lines and receipts.
 * Called after every change, so stored figures can never drift from the detail.
 */
function recompute(bill: BDoc) {
  const lines = live(bill);
  const calc = hospitalBill(lines.map((l) => ({ qty: l.qty, rate: l.rate, discountPct: l.discountPct ?? 0, gstRate: l.gstRate ?? 0 })), bill.billDiscount ?? 0);
  lines.forEach((l, i) => Object.assign(l, calc.lines[i]));
  Object.assign(bill, calc.totals);
  if (bill.billDiscount === 0) {
    bill.discountReason = lines.some((l) => (l.discountPct ?? 0) > 0) ? bill.discountReason : undefined;
  }

  const split = payerSplit({ net: bill.netAmount, payerType: bill.payerType, coveragePct: bill.coveragePct, payerLimit: bill.payerLimit, movedToPatient: bill.movedToPatient });
  bill.payerShare = split.payerShare;
  bill.patientShare = split.patientShare;

  const sumOf = (kinds: ReceiptKind[]) => r2(bill.receipts.filter((r) => kinds.includes(r.kind)).reduce((s, r) => s + counted(r), 0));
  bill.patientPaid = r2(sumOf(["Advance", "Payment"]) - sumOf(["Refund"]));
  bill.payerPaid = sumOf(["Settlement"]);
  bill.payerWriteOff = r2(bill.receipts.filter((r) => r.kind === "Settlement").reduce((s, r) => s + (r.writeOff ?? 0), 0));

  if (bill.status === "Cancelled") {
    bill.patientDue = 0;
    bill.payerDue = 0;
    bill.refundDue = Math.max(0, bill.patientPaid);
    bill.paymentStatus = bill.refundDue > 0 ? "Refund Due" : "Cancelled";
    return;
  }
  const credit = r2(Math.max(0, bill.patientPaid - bill.patientShare));
  bill.patientDue = r2(Math.max(0, bill.patientShare - bill.patientPaid));
  // While the bill is provisional an excess is an advance, not a refund.
  bill.refundDue = bill.status === "Provisional" ? 0 : credit;
  bill.payerDue = bill.payerType === "Self" ? 0 : r2(Math.max(0, bill.payerShare - bill.payerPaid - bill.payerWriteOff));

  if (bill.refundDue > 0) bill.paymentStatus = "Refund Due";
  else if (bill.status === "Provisional" && credit > 0) bill.paymentStatus = "Advance";
  else if (bill.patientDue <= 0) bill.paymentStatus = bill.netAmount === 0 && bill.patientPaid === 0 ? "Unpaid" : "Paid";
  else bill.paymentStatus = bill.patientPaid > 0 ? "Partially Paid" : "Unpaid";

  if (bill.status === "Final" || bill.status === "Closed") {
    bill.status = bill.patientDue === 0 && bill.payerDue === 0 && bill.refundDue === 0 ? "Closed" : "Final";
  }
}

async function save(bill: BDoc) {
  try {
    await bill.save();
  } catch (err) {
    if (err instanceof mongoose.Error.VersionError) throw new ApiError(409, "This bill was just updated by someone else. Refresh and try again.");
    throw err;
  }
}

async function loadBill(id: string) {
  if (!isObjectId(id)) throw new ApiError(404, "Bill not found");
  const bill = await Bill.findById(id);
  if (!bill) throw new ApiError(404, "Bill not found");
  return bill as unknown as BDoc;
}

function audit(req: Request, user: Pick<SessionUser, "id" | "name" | "email" | "role">, bill: { _id: unknown; code: string }, summary: string, action: "create" | "update" = "update") {
  return logActivity({ req, user, action, module: "billing", resource: "bills", entityId: String(bill._id), entityLabel: bill.code, summary });
}

const money = (n: number) => `₹${r2(n).toLocaleString("en-IN")}`;

/* ======================= rates & catalog ======================= */

async function planRates(serviceIds: unknown[], plan: string) {
  if (!serviceIds.length || plan === "General") return new Map<string, number>();
  const now = new Date();
  const rows = await Rates()
    .find({ service: { $in: serviceIds }, ratePlan: plan, status: "Active", $or: [{ effectiveFrom: null }, { effectiveFrom: { $exists: false } }, { effectiveFrom: { $lte: now } }] })
    .lean<Doc[]>();
  return new Map(rows.map((r) => [String(r.service), Number(r.rate)]));
}

/** Doctor fee for a fee type from the doctor master (null = enter manually). */
function doctorFee(d: Doc, feeType: string): number | null {
  const n = (k: string) => (typeof d[k] === "number" ? (d[k] as number) : null);
  switch (feeType) {
    case "Consultation":
      return n("consultationFee");
    case "Follow-up":
      return n("followUpFee") ?? n("consultationFee");
    case "Emergency":
      return n("emergencyFee") ?? n("consultationFee");
    case "IPD Visit":
      return n("ipdVisitFee") ?? n("consultationFee");
    default:
      return null;
  }
}

function feeCategory(feeType: string): (typeof SERVICE_CATEGORIES)[number] {
  if (feeType === "Emergency") return "Emergency";
  if (["Surgeon", "Assistant Surgeon", "Anaesthetist"].includes(feeType)) return "Surgery / OT";
  if (feeType === "Procedure") return "Procedure";
  return "Consultation";
}

/** Services and packages priced for a rate plan, or one doctor's fee schedule. */
export async function catalog(url: URL) {
  const plan = (RATE_PLANS as readonly string[]).includes(String(url.searchParams.get("plan"))) ? String(url.searchParams.get("plan")) : "General";
  const doctorId = url.searchParams.get("doctor");
  if (doctorId) {
    const d = isObjectId(doctorId) ? await Doctors().findById(doctorId).lean<Doc>() : null;
    if (!d) throw new ApiError(404, "Doctor not found");
    return {
      doctor: {
        id: String(d._id), name: String(d.fullName), code: (d.code as string) ?? "", specialization: (d.specialization as string) ?? "", status: d.status,
        sharePct: typeof d.revenueSharePct === "number" ? d.revenueSharePct : 0,
        fees: Object.fromEntries(DOCTOR_FEE_TYPES.map((t) => [t, doctorFee(d, t)])),
      },
    };
  }
  const q = text(url.searchParams.get("q"), 60);
  const rx = q ? new RegExp(escapeRegex(q), "i") : null;
  const category = url.searchParams.get("category");
  const [services, packages] = await Promise.all([
    Services()
      .find({ status: "Active", ...(rx ? { $or: [{ name: rx }, { code: rx }] } : {}), ...(category && (SERVICE_CATEGORIES as readonly string[]).includes(category) ? { category } : {}) })
      .sort({ name: 1 }).limit(25).lean<Doc[]>(),
    category && category !== "Package" ? Promise.resolve([] as Doc[]) : Packages().find({ status: "Active", ...(rx ? { $or: [{ name: rx }, { code: rx }] } : {}) }).sort({ name: 1 }).limit(10).populate({ path: "services", select: "name code" }).lean<Doc[]>(),
  ]);
  const rates = await planRates(services.map((s) => s._id), plan);
  return {
    services: services.map((s) => ({
      id: String(s._id), name: String(s.name), code: String(s.code ?? ""), category: String(s.category), unit: (s.unit as string) ?? "Per service",
      rate: rates.get(String(s._id)) ?? Number(s.rate ?? 0), gstRate: Number(s.gstRate ?? 0), editable: s.rateEditable === "Yes",
    })),
    packages: packages.map((p) => ({
      id: String(p._id), name: String(p.name), code: String(p.code ?? ""), rate: Number(p.rate ?? 0), gstRate: Number(p.gstRate ?? 0), billType: (p.billType as string) ?? null,
      services: ((p.services as Doc[] | undefined) ?? []).filter((s) => s && typeof s === "object").map((s) => String(s.name)),
    })),
  };
}

/* ======================= patient context ======================= */

/** Departmental bills (lab, pharmacy) that the patient still owes. */
async function departmentDues(patientId: Types.ObjectId) {
  const [lab, sales] = await Promise.all([
    LabOrder.find({ patient: patientId, paymentStatus: { $in: ["Unpaid", "Partially Paid"] } }).select("code orderDate netAmount paidAmount").sort({ orderDate: 1 }).lean(),
    Sale.find({ patient: patientId, status: { $in: ["Unpaid", "Partially Paid"] } }).select("code billDate netAmount paidAmount").sort({ billDate: 1 }).lean(),
  ]);
  return [
    ...lab.map((o) => ({ source: "Laboratory", id: String(o._id), code: o.code, date: o.orderDate.toISOString(), net: o.netAmount, paid: o.paidAmount, balance: r2(o.netAmount - o.paidAmount) })),
    ...sales.map((s) => ({ source: "Pharmacy", id: String(s._id), code: s.code, date: s.billDate.toISOString(), net: s.netAmount, paid: s.paidAmount ?? 0, balance: r2(s.netAmount - (s.paidAmount ?? 0)) })),
  ].filter((d) => d.balance > 0);
}

export async function patientContext(patientId: string) {
  if (!isObjectId(patientId)) throw new ApiError(404, "Patient not found");
  const p = await Patients().findById(patientId).select("fullName code gender dateOfBirth mobile").lean<Doc>();
  if (!p) throw new ApiError(404, "Patient not found");
  const since = new Date(todayUtc().getTime() - 30 * DAY);
  const [visits, admissions, openBills, dueBills, deptDues] = await Promise.all([
    Visits().find({ patient: p._id, visitDate: { $gte: since }, status: { $ne: "Cancelled" } }).sort({ visitDate: -1 }).limit(10).populate({ path: "doctor", select: "fullName code" }).lean<Doc[]>(),
    Admissions().find({ patient: p._id, status: "Admitted" }).sort({ admissionDate: -1 }).limit(5).populate({ path: "doctor", select: "fullName code" }).lean<Doc[]>(),
    Bill.find({ patient: p._id, status: "Provisional" }).select("code billType billDate admissionCode netAmount patientPaid").sort({ billDate: -1 }).lean(),
    Bill.find({ patient: p._id, status: "Final", patientDue: { $gt: 0 } }).select("code billDate patientDue").lean(),
    departmentDues(p._id),
  ]);
  const doc = (d: unknown) => (d && typeof d === "object" ? { id: String((d as Doc)._id), label: String((d as Doc).fullName), code: (d as Doc).code as string } : null);
  return {
    patient: { id: String(p._id), name: String(p.fullName), code: (p.code as string) ?? "", gender: (p.gender as string) ?? "", age: ageYears(p.dateOfBirth) ?? null, mobile: (p.mobile as string) ?? "" },
    visits: visits.map((v) => ({ id: String(v._id), code: String(v.code), date: (v.visitDate as Date)?.toISOString(), department: (v.department as string) ?? "", status: v.status, doctor: doc(v.doctor) })),
    admissions: admissions.map((a) => ({ id: String(a._id), code: String(a.code), date: (a.admissionDate as Date)?.toISOString(), ward: a.ward, bed: a.bedNumber, doctor: doc(a.doctor), days: stayDays(a.admissionDate as Date) })),
    openBills: openBills.map((b) => ({ id: String(b._id), code: b.code, billType: b.billType, date: b.billDate.toISOString(), admissionCode: b.admissionCode ?? null, netAmount: b.netAmount, paid: b.patientPaid })),
    previousDue: r2(dueBills.reduce((s, b) => s + b.patientDue, 0)),
    deptDues,
  };
}

/* ======================= charge lines ======================= */

interface LineCtx {
  ratePlan: string;
  billType: string;
  admissionDate?: Date | null;
  dischargeDate?: Date | null;
}

/** Validate and price charge inputs. Prices always come from the masters, never the browser. */
async function buildLines(raw: unknown, ctx: LineCtx, user: SessionUser) {
  const inputs = (Array.isArray(raw) ? raw : []).slice(0, MAX_LINES + 1) as Record<string, unknown>[];
  if (inputs.length > MAX_LINES) fail({ lines: `At most ${MAX_LINES} charges per bill` });
  const ids = (k: string) => inputs.map((l) => l[k]).filter((v): v is string => isObjectId(v));
  const [services, packages, doctors] = await Promise.all([
    Services().find({ _id: { $in: ids("service") } }).lean<Doc[]>(),
    Packages().find({ _id: { $in: ids("package") } }).populate({ path: "services", select: "name" }).lean<Doc[]>(),
    Doctors().find({ _id: { $in: ids("doctor") } }).lean<Doc[]>(),
  ]);
  const byId = (rows: Doc[]) => new Map(rows.map((r) => [String(r._id), r]));
  const sMap = byId(services);
  const pMap = byId(packages);
  const dMap = byId(doctors);
  const rates = await planRates(services.map((s) => s._id), ctx.ratePlan);
  const now = new Date();
  const out: Record<string, unknown>[] = [];
  const errors: Record<string, string> = {};

  inputs.forEach((l, i) => {
    const key = `lines.${i}`;
    const qtyIn = num(l.qty, 1);
    const qty = r2(qtyIn);
    const discountPct = r2(num(l.discountPct, 0));
    if (!(qty > 0 && qty <= 1000)) return void (errors[key] = "Quantity must be between 0.01 and 1000");
    if (!(discountPct >= 0 && discountPct <= 100)) return void (errors[key] = "Discount must be 0–100%");
    const serviceDate = parseDay(l.serviceDate) ?? undefined;
    const base = { qty, discountPct, serviceDate, addedAt: now, addedByName: user.name, status: "Active" };
    const kind = String(l.kind ?? "");

    if (kind === "service") {
      const s = sMap.get(String(l.service));
      if (!s || s.status !== "Active") return void (errors[key] = "Service not found or inactive");
      const editable = s.rateEditable === "Yes";
      let rate = rates.get(String(s._id)) ?? Number(s.rate ?? 0);
      const override = l.rate !== undefined && l.rate !== "" && l.rate !== null ? r2(num(l.rate)) : null;
      if (override !== null && override !== rate) {
        if (!editable) return void (errors[key] = `${s.name}: rate is fixed by the Rate List`);
        if (!(override >= 0)) return void (errors[key] = `${s.name}: enter a valid rate`);
        rate = override;
      }
      let doctorName: string | undefined;
      if (l.doctor) {
        const d = dMap.get(String(l.doctor));
        if (!d) return void (errors[key] = "Performing doctor not found");
        doctorName = String(d.fullName);
      }
      out.push({
        ...base, kind: "Service", category: s.category, service: s._id, name: s.name, code: s.code, unit: s.unit ?? "Per service", rate,
        gstRate: Number(s.gstRate ?? 0), rateEditable: editable, rateOverridden: override !== null && editable, doctor: doctorName ? l.doctor : undefined, doctorName,
        detail: text(l.detail, 200) || undefined,
      });
    } else if (kind === "package") {
      const p = pMap.get(String(l.package));
      if (!p || p.status !== "Active") return void (errors[key] = "Package not found or inactive");
      if (p.billType && p.billType !== ctx.billType) return void (errors[key] = `${p.name} is a ${p.billType} package`);
      out.push({
        ...base, qty: 1, kind: "Package", category: "Package", package: p._id, name: p.name, code: p.code, unit: "Per package", rate: Number(p.rate ?? 0), gstRate: Number(p.gstRate ?? 0),
        detail: `Includes: ${((p.services as Doc[] | undefined) ?? []).filter((s) => s && typeof s === "object").map((s) => s.name).join(", ")}`.slice(0, 500),
      });
    } else if (kind === "doctor") {
      const d = dMap.get(String(l.doctor));
      if (!d) return void (errors[key] = "Select the doctor");
      if (d.status === "Inactive") return void (errors[key] = `${d.fullName} is inactive`);
      const feeType = String(l.feeType ?? "");
      if (!(DOCTOR_FEE_TYPES as readonly string[]).includes(feeType)) return void (errors[key] = "Select the fee type");
      const fixed = doctorFee(d, feeType);
      const rate = fixed ?? r2(num(l.rate));
      if (!(rate >= 0) || (fixed === null && !(rate > 0))) return void (errors[key] = `Enter the ${feeType.toLowerCase()} fee for ${d.fullName}`);
      out.push({
        ...base, kind: "Doctor Fee", category: feeCategory(feeType), doctor: d._id, doctorName: d.fullName, feeType, name: `${feeType} fee — ${d.fullName}`, code: d.code,
        unit: feeType === "IPD Visit" ? "Per visit" : "Per service", rate, gstRate: 0, rateEditable: fixed === null,
        doctorSharePct: typeof d.revenueSharePct === "number" ? d.revenueSharePct : 0, detail: text(l.detail, 200) || undefined,
      });
    } else if (kind === "manual") {
      const name = text(l.name, 120);
      const category = String(l.category ?? "");
      const rate = r2(num(l.rate));
      const gstRate = num(l.gstRate, 0);
      if (name.length < 3) return void (errors[key] = "Describe the charge");
      if (!(SERVICE_CATEGORIES as readonly string[]).includes(category)) return void (errors[key] = "Select the billing head");
      if (!(rate > 0)) return void (errors[key] = `${name}: enter the rate`);
      if (!(GST_RATES as readonly string[]).includes(String(gstRate))) return void (errors[key] = "Invalid GST rate");
      out.push({ ...base, kind: "Manual", category, name, unit: "Per service", rate, gstRate, rateEditable: true, detail: text(l.detail, 200) || undefined });
    } else {
      errors[key] = "Unknown charge type";
    }
  });
  if (Object.keys(errors).length) fail(errors, Object.values(errors)[0]);
  return out;
}

/* ======================= payer ======================= */

/** Resolve payer fields from input; returns the values to set on the bill. */
async function resolvePayer(body: Record<string, unknown>, current?: BDoc) {
  const payerType = (PAYER_TYPES as readonly string[]).includes(String(body.payerType)) ? String(body.payerType) : (current?.payerType ?? "Self");
  const errors: Record<string, string> = {};
  const limit = body.payerLimit === "" || body.payerLimit === null || body.payerLimit === undefined ? undefined : r2(num(body.payerLimit));
  if (limit !== undefined && !(limit >= 0)) errors.payerLimit = "Enter a valid approved amount";
  const set: Record<string, unknown> = {
    payerType, corporate: undefined, insuranceProvider: undefined, payerName: undefined, tpaName: undefined, policyNo: undefined, authNo: undefined,
    payerLimit: payerType === "Self" ? undefined : limit, coveragePct: undefined, creditDays: undefined,
  };
  let ratePlan: string | null = null;
  if (payerType === "Corporate") {
    const c = isObjectId(body.corporate) ? await Corporates().findById(body.corporate).lean<Doc>() : null;
    if (!c) errors.corporate = "Select the corporate / credit party";
    else if (c.status !== "Active") errors.corporate = `${c.name} is inactive`;
    else if (c.agreementValidUntil instanceof Date && c.agreementValidUntil < todayUtc()) errors.corporate = `${c.name}'s agreement expired on ${c.agreementValidUntil.toISOString().slice(0, 10)}`;
    else {
      Object.assign(set, { corporate: c._id, payerName: c.name, coveragePct: Number(c.coveragePct ?? 100), creditDays: Number(c.creditDays ?? 30), authNo: text(body.authNo, 60) || undefined, policyNo: text(body.policyNo, 60) || undefined });
      ratePlan = String(c.ratePlan ?? "Corporate");
    }
  } else if (payerType === "Insurance") {
    const p = isObjectId(body.insuranceProvider) ? await Providers().findById(body.insuranceProvider).lean<Doc>() : null;
    if (!p) errors.insuranceProvider = "Select the insurance company";
    const policyNo = text(body.policyNo, 60);
    if (!policyNo) errors.policyNo = "Enter the policy / card number";
    if (p) Object.assign(set, { insuranceProvider: p._id, payerName: p.name, policyNo, tpaName: text(body.tpaName, 80) || undefined, authNo: text(body.authNo, 60) || undefined, coveragePct: 100, creditDays: 45 });
    ratePlan = "Insurance";
  }
  if (Object.keys(errors).length) fail(errors);
  return { set, ratePlan };
}

/** Corporate credit limit: existing payer dues plus this bill's share. */
async function checkCreditLimit(bill: BDoc) {
  if (bill.payerType !== "Corporate" || !bill.corporate || bill.payerShare <= 0) return;
  const c = await Corporates().findById(bill.corporate).lean<Doc>();
  const limit = typeof c?.creditLimit === "number" ? c.creditLimit : null;
  if (limit === null) return;
  const [row] = await Bill.aggregate<{ s: number }>([
    { $match: { corporate: bill.corporate, _id: { $ne: bill._id }, status: { $in: ["Final", "Closed"] } } },
    { $group: { _id: null, s: { $sum: "$payerDue" } } },
  ]);
  const outstanding = r2(row?.s ?? 0);
  if (outstanding + bill.payerShare > limit) {
    throw new ApiError(409, `${bill.payerName} credit limit is ${money(limit)}; ${money(outstanding)} is already outstanding. Collect from the patient or raise the limit.`);
  }
}

/* ======================= receipts ======================= */

function parseSplits(raw: unknown) {
  const rows = (Array.isArray(raw) ? raw : []) as Record<string, unknown>[];
  if (rows.length > MAX_SPLITS) fail({ splits: `At most ${MAX_SPLITS} payment modes per receipt` });
  const errors: Record<string, string> = {};
  const splits = rows
    .map((s, i) => {
      const mode = String(s.mode ?? "");
      const amount = r2(num(s.amount));
      const reference = text(s.reference, 60);
      if (!(BILL_PAYMENT_MODES as readonly string[]).includes(mode)) errors[`splits.${i}`] = "Select the payment mode";
      else if (!(amount > 0)) errors[`splits.${i}`] = `Enter the ${mode.toLowerCase()} amount`;
      else if ((mode === "Cheque" || mode === "Bank Transfer") && !reference) errors[`splits.${i}`] = `Enter the ${mode === "Cheque" ? "cheque" : "UTR / transaction"} number`;
      return { mode, amount, reference: reference || undefined, recon: mode === "Cash" ? "Not Required" : "Pending" };
    })
    .filter((s) => s.amount > 0 || rows.length === 1);
  if (Object.keys(errors).length) fail(errors, Object.values(errors)[0]);
  return splits;
}

async function openShiftOf(userId: string) {
  return Shift.findOne({ user: userId, status: "Open" });
}

async function assertDayOpen() {
  const closed = await DayClose.exists({ date: todayUtc() });
  if (closed) throw new ApiError(409, "Today's cash is already closed. Ask the super admin to reopen the day to take more receipts.");
}

/** Validate a receipt and add it to the (unsaved) bill. Returns a summary for the audit log. */
async function applyReceipt(bill: BDoc, body: Record<string, unknown>, user: SessionUser) {
  const kind = String(body.kind ?? "") as ReceiptKind;
  if (!(RECEIPT_KINDS as readonly string[]).includes(kind)) fail({ kind: "Unknown receipt type" });
  const splits = parseSplits(body.splits);
  const amount = r2(splits.reduce((s, x) => s + x.amount, 0));
  const reason = text(body.reason, 300);
  const approvedBy = text(body.approvedBy, 80) || undefined;
  let writeOff = 0;
  let toPatient = 0;

  switch (kind) {
    case "Advance":
      if (bill.status !== "Provisional") throw new ApiError(409, "Advances are taken on provisional bills. Collect a payment instead.");
      if (!(amount > 0)) fail({ splits: "Enter the advance amount" });
      if (amount > 10_000_000) fail({ splits: "Amount looks too large" });
      break;
    case "Payment":
      if (bill.status === "Cancelled" || bill.status === "Closed") throw new ApiError(409, `This bill is ${bill.status.toLowerCase()}`);
      if (!(amount > 0)) fail({ splits: "Enter the amount received" });
      if (amount > bill.patientDue) fail({ splits: bill.patientDue > 0 ? `Only ${money(bill.patientDue)} is due from the patient` : "Nothing is due from the patient" });
      break;
    case "Refund": {
      const refundable = bill.status === "Cancelled" ? bill.patientPaid : r2(Math.max(0, bill.patientPaid - bill.patientShare));
      if (!(amount > 0)) fail({ splits: "Enter the refund amount" });
      if (amount > refundable) fail({ splits: refundable > 0 ? `At most ${money(refundable)} can be refunded` : "Nothing is refundable on this bill" });
      if (reason.length < 3) fail({ reason: "Enter the reason for the refund" });
      break;
    }
    case "Settlement": {
      if (bill.payerType === "Self") throw new ApiError(409, "This is a self-pay bill");
      if (bill.status !== "Final") throw new ApiError(409, bill.status === "Provisional" ? "Finalise the bill before recording the payer's settlement" : `This bill is ${bill.status.toLowerCase()}`);
      writeOff = r2(num(body.writeOff, 0));
      toPatient = r2(num(body.toPatient, 0));
      if (!(writeOff >= 0)) fail({ writeOff: "Enter a valid deduction" });
      if (!(toPatient >= 0)) fail({ toPatient: "Enter a valid amount" });
      const total = r2(amount + writeOff + toPatient);
      if (!(total > 0)) fail({ splits: "Enter the amount received from the payer" });
      if (total > bill.payerDue) fail({ splits: `Only ${money(bill.payerDue)} is due from ${bill.payerName}` });
      if ((writeOff > 0 || toPatient > 0) && reason.length < 3) fail({ reason: "Enter the reason for the deduction / disallowance" });
      break;
    }
  }

  // Money that physically passes the counter needs the cashier's open shift.
  let shift = await openShiftOf(user.id);
  if (kind !== "Settlement") {
    if (!shift) throw new ApiError(409, "Open your cash counter shift first (Billing → Cash Counter & Shifts).");
    await assertDayOpen();
  } else if (!splits.length) {
    shift = null;
  }
  const code = await nextCode(kind === "Refund" ? "RFD" : kind === "Settlement" ? "STL" : "RCP");
  bill.receipts.push({
    code, kind, amount, splits, writeOff, toPatient, reason: reason || undefined, approvedBy, at: new Date(),
    by: new Types.ObjectId(user.id), byName: user.name, shift: shift?._id, shiftCode: shift?.code,
  });
  if (toPatient > 0) bill.movedToPatient = r2((bill.movedToPatient ?? 0) + toPatient);
  recompute(bill);
  const modes = splits.map((s) => `${s.mode} ${money(s.amount)}`).join(" + ");
  return kind === "Settlement"
    ? `Recorded settlement ${code} from ${bill.payerName} on ${bill.code}: received ${money(amount)}${modes ? ` (${modes})` : ""}${writeOff ? `, written off ${money(writeOff)}` : ""}${toPatient ? `, moved ${money(toPatient)} to patient` : ""}${reason ? `. ${reason}` : ""}`
    : `${kind === "Refund" ? "Refunded" : kind === "Advance" ? "Collected advance" : "Collected"} ${money(amount)} (${modes}) — ${code} on ${bill.code}${reason ? `. Reason: ${reason}` : ""}`;
}

/* ======================= finalise ======================= */

/** Checks and status change for finalising; side effects run after saving. */
async function applyFinalize(bill: BDoc, body: Record<string, unknown>, user: SessionUser) {
  if (bill.status !== "Provisional") throw new ApiError(409, `Bill is already ${bill.status.toLowerCase()}`);
  if (live(bill).length === 0) throw new ApiError(422, "Add at least one charge before finalising");
  if (bill.payerType === "Insurance" && (!bill.insuranceProvider || !bill.policyNo)) fail({ policyNo: "Insurance bills need the insurer and policy number" });
  bill.status = "Final";
  bill.finalizedAt = new Date();
  bill.finalizedByName = user.name;
  const discharge = body.discharge === true && bill.billType === "IPD" && !!bill.admission;
  if (discharge) bill.dischargeDate = todayUtc();
  recompute(bill);
  await checkCreditLimit(bill);
  return { discharge };
}

/** Insurance claim and discharge, once the final bill is saved. */
async function afterFinalize(bill: BDoc, opts: { discharge: boolean }, user: SessionUser) {
  const notes: string[] = [];
  if (opts.discharge && bill.admission) {
    await Admissions().updateOne({ _id: bill.admission, status: "Admitted" }, { $set: { status: "Discharged", dischargeDate: bill.dischargeDate, updatedBy: user.id } });
    notes.push(`patient discharged from ${bill.admissionCode}`);
  }
  if (bill.payerType === "Insurance") {
    // The claim (with its document checklist and pre-auth link) is worked in the Insurance module.
    const note = await raiseClaimForBill(bill, user);
    if (note) notes.push(note);
  }
  return notes;
}

/* ======================= create ======================= */

export async function createBill(body: Record<string, unknown>, user: SessionUser, req: Request) {
  const errors: Record<string, string> = {};
  let patient: Doc | null = null;
  if (!isObjectId(body.patient)) errors.patient = "Select the patient";
  else if (!(patient = await Patients().findById(body.patient).lean<Doc>())) errors.patient = "Patient not found";
  const billType = String(body.billType ?? "");
  if (!(BILL_TYPES as readonly string[]).includes(billType)) errors.billType = "Select the bill type";

  let visit: Doc | null = null;
  let admission: Doc | null = null;
  if (patient && body.visit && billType !== "IPD") {
    visit = isObjectId(body.visit) ? await Visits().findById(body.visit).lean<Doc>() : null;
    if (!visit || !sameId(visit.patient, patient._id)) errors.visit = "Select an OPD visit of this patient";
  }
  if (patient && billType === "IPD") {
    admission = isObjectId(body.admission) ? await Admissions().findById(body.admission).lean<Doc>() : null;
    if (!admission || !sameId(admission.patient, patient._id)) errors.admission = "Select the patient's admission";
    else {
      const open = await Bill.findOne({ admission: admission._id, status: "Provisional" }).select("code").lean();
      if (open) errors.admission = `Admission ${admission.code} already has an open bill (${open.code}). Add charges to that bill.`;
    }
  }
  let doctor: Doc | null = null;
  const doctorId = body.doctor || visit?.doctor || admission?.doctor;
  if (doctorId) {
    doctor = isObjectId(String(doctorId)) ? await Doctors().findById(doctorId).lean<Doc>() : null;
    if (!doctor) errors.doctor = "Doctor not found";
  }
  if (Object.keys(errors).length) fail(errors);

  // An admission with an approved cashless pre-auth opens as an insurance bill with the sanctioned limit.
  const preauth = admission && body.payerType === undefined ? await approvedPreauthPayer(admission._id) : null;
  if (preauth) body = { ...body, ...preauth.payer };
  const { set: payer, ratePlan: payerPlan } = await resolvePayer(body);
  const ratePlan = payerPlan ?? ((RATE_PLANS as readonly string[]).includes(String(body.ratePlan)) ? String(body.ratePlan) : "General");
  const lines = await buildLines(body.lines, { ratePlan, billType, admissionDate: admission?.admissionDate as Date | undefined }, user);

  const billDiscount = r2(num(body.discount, 0));
  if (!(billDiscount >= 0)) fail({ discount: "Enter a valid discount" });
  const discountReason = text(body.discountReason, 300);
  if ((billDiscount > 0 || lines.some((l) => Number(l.discountPct) > 0)) && discountReason.length < 3) fail({ discountReason: "Enter the reason for the discount" });

  const now = new Date();
  const bill = new Bill({
    code: "pending", billDate: todayUtc(), billType,
    patient: patient!._id, patientName: patient!.fullName, patientCode: patient!.code, patientGender: patient!.gender, patientAge: ageYears(patient!.dateOfBirth, now), patientMobile: patient!.mobile,
    visit: visit?._id, visitCode: visit?.code,
    admission: admission?._id, admissionCode: admission?.code, admissionDate: admission?.admissionDate, wardBed: admission ? `${admission.ward} / ${admission.bedNumber}` : undefined,
    doctor: doctor?._id, doctorName: doctor?.fullName, department: text(body.department, 60) || (visit?.department as string | undefined) || (doctor?.specialization as string | undefined),
    ratePlan, ...payer, lines, billDiscount, discountReason: discountReason || undefined, discountApprovedBy: text(body.discountApprovedBy, 80) || undefined,
    notes: text(body.notes, 500) || undefined, createdBy: user.id, createdByName: user.name,
  }) as unknown as BDoc;
  recompute(bill);
  if (billDiscount > 0 && bill.billDiscount < billDiscount) fail({ discount: `Discount cannot exceed ${money(bill.billDiscount + bill.taxableAmount)}` });

  const summary: string[] = [];
  let finalize: { discharge: boolean } | null = null;
  if (body.finalize === true) finalize = await applyFinalize(bill, body, user);
  const payment = body.payment && typeof body.payment === "object" ? (body.payment as Record<string, unknown>) : null;
  if (payment && Array.isArray(payment.splits) && payment.splits.length) summary.push(await applyReceipt(bill, payment, user));

  bill.code = await nextCode("BILL");
  await save(bill);
  if (preauth) {
    await linkPreauthBill(preauth.id, bill, user);
    summary.push(`insurance from pre-auth ${preauth.code} (approved ${money(Number(preauth.payer.payerLimit))})`);
  }
  const notes = finalize ? await afterFinalize(bill, finalize, user) : [];
  await audit(req, user, bill,
    `Created ${finalize ? "final" : "provisional"} ${billType} bill ${bill.code} for ${bill.patientName}${bill.payerType !== "Self" ? ` (${bill.payerType}: ${bill.payerName})` : ""} — ${live(bill).length} charge(s), net ${money(bill.netAmount)}${summary.length ? `; ${summary.join("; ")}` : ""}${notes.length ? `; ${notes.join("; ")}` : ""}`,
    "create");
  return bill;
}

/* ======================= read ======================= */

export async function getBill(id: string) {
  const bill = await loadBill(id);
  const out = plain(bill.toObject()) as Record<string, unknown>;
  return { ...out, deptDues: await departmentDues(bill.patient), hospital: hospitalInfo(), stayDays: bill.admissionDate ? stayDays(bill.admissionDate, bill.dischargeDate) : null };
}

function billHeader(d: Record<string, unknown>) {
  const lines = ((d.lines as { status: string; category: string }[]) ?? []).filter((l) => l.status !== "Cancelled");
  return {
    id: String(d._id), code: d.code, billDate: (d.billDate as Date)?.toISOString(), billType: d.billType, patient: String(d.patient), patientName: d.patientName, patientCode: d.patientCode ?? null,
    patientAge: d.patientAge ?? null, patientGender: d.patientGender ?? null, patientMobile: d.patientMobile ?? null, admissionCode: d.admissionCode ?? null, wardBed: d.wardBed ?? null,
    doctorName: d.doctorName ?? null, payerType: d.payerType, payerName: d.payerName ?? null, status: d.status, paymentStatus: d.paymentStatus,
    netAmount: d.netAmount, discountAmount: d.discountAmount ?? 0, patientShare: d.patientShare, payerShare: d.payerShare, patientPaid: d.patientPaid, patientDue: d.patientDue,
    payerDue: d.payerDue, refundDue: d.refundDue, charges: lines.length, heads: [...new Set(lines.map((l) => l.category))],
    finalizedAt: (d.finalizedAt as Date | undefined)?.toISOString() ?? null, createdByName: d.createdByName ?? null, claimCode: d.claimCode ?? null, policyNo: d.policyNo ?? null,
  };
}

function rangeFilter(url: URL, field: string) {
  const from = parseDay(url.searchParams.get("from"));
  const to = parseDay(url.searchParams.get("to"));
  if (!from && !to) return {};
  return { [field]: { ...(from ? { $gte: from } : {}), ...(to ? { $lte: new Date(to.getTime() + DAY - 1) } : {}) } };
}

export async function listBills(url: URL) {
  const { page, limit, skip } = parsePaging(url, 15);
  const filter: Record<string, unknown> = { ...rangeFilter(url, "billDate") };
  const q = url.searchParams.get("search")?.trim();
  if (q) {
    const rx = new RegExp(escapeRegex(q.slice(0, 60)), "i");
    filter.$or = [{ code: rx }, { patientName: rx }, { patientCode: rx }, { patientMobile: rx }, { admissionCode: rx }, { "receipts.code": q.toUpperCase() }, { payerName: rx }, { claimCode: rx }];
  }
  for (const key of ["status", "billType", "paymentStatus", "payerType"]) {
    const v = url.searchParams.get(key);
    if (v) filter[key] = v;
  }
  const patient = url.searchParams.get("patient");
  if (patient && isObjectId(patient)) filter.patient = new Types.ObjectId(patient);
  if (url.searchParams.get("due") === "1") filter.patientDue = { $gt: 0 };
  const [docs, total] = await Promise.all([
    Bill.find(filter).sort({ billDate: -1, createdAt: -1 }).skip(skip).limit(limit).select("-receipts -lines.detail").lean(),
    Bill.countDocuments(filter),
  ]);
  return { items: docs.map((d) => billHeader(d as unknown as Record<string, unknown>)), pagination: pagination(page, limit, total) };
}

/* ======================= update header ======================= */

/** Rate plan changes re-price service lines that were not priced by hand. */
async function reprice(bill: BDoc) {
  const lines = live(bill).filter((l) => l.kind === "Service" && l.service && !l.rateOverridden);
  if (!lines.length) return;
  const [services, rates] = await Promise.all([Services().find({ _id: { $in: lines.map((l) => l.service) } }).lean<Doc[]>(), planRates(lines.map((l) => l.service), bill.ratePlan)]);
  const base = new Map(services.map((s) => [String(s._id), Number(s.rate ?? 0)]));
  for (const l of lines) l.rate = rates.get(String(l.service)) ?? base.get(String(l.service)) ?? l.rate;
}

export async function updateBill(id: string, body: Record<string, unknown>, user: SessionUser, req: Request) {
  const bill = await loadBill(id);
  const changes: string[] = [];
  if ("notes" in body) {
    bill.notes = text(body.notes, 500) || undefined;
    changes.push("notes");
  }
  if (bill.status === "Cancelled" || bill.status === "Closed") {
    if (changes.length !== Object.keys(body).length) throw new ApiError(409, `This bill is ${bill.status.toLowerCase()}; only notes can be changed`);
  } else if (bill.status === "Final") {
    // After finalising, only payer paperwork may change (approval often arrives after discharge).
    const allowed = new Set(["notes", "payerLimit", "authNo", "policyNo", "tpaName"]);
    const bad = Object.keys(body).find((k) => !allowed.has(k));
    if (bad) throw new ApiError(409, "The bill is final. Reopen it to change charges, discount or payer.");
    if (bill.payerType === "Self") throw new ApiError(409, "Self-pay bill has no payer details");
    if ("payerLimit" in body) {
      if (bill.receipts.some((r) => r.kind === "Settlement")) throw new ApiError(409, "The payer has already settled part of this bill");
      const limit = body.payerLimit === "" || body.payerLimit === null ? undefined : r2(num(body.payerLimit));
      if (limit !== undefined && !(limit >= 0)) fail({ payerLimit: "Enter a valid approved amount" });
      bill.payerLimit = limit;
      changes.push(`approved amount ${limit === undefined ? "cleared" : money(limit)}`);
    }
    for (const k of ["authNo", "policyNo", "tpaName"] as const) {
      if (k in body) {
        const v = text(body[k], k === "tpaName" ? 80 : 60);
        if (k === "policyNo" && !v && bill.payerType === "Insurance") fail({ policyNo: "Policy number is required" });
        bill[k] = v || undefined;
        changes.push(k);
      }
    }
  } else {
    if ("doctor" in body) {
      const d = body.doctor ? (isObjectId(body.doctor) ? await Doctors().findById(body.doctor).lean<Doc>() : null) : null;
      if (body.doctor && !d) fail({ doctor: "Doctor not found" });
      bill.doctor = d?._id;
      bill.doctorName = d ? String(d.fullName) : undefined;
      changes.push("consultant");
    }
    if ("department" in body) {
      bill.department = text(body.department, 60) || undefined;
      changes.push("department");
    }
    if ("payerType" in body) {
      const { set, ratePlan } = await resolvePayer(body, bill);
      if (bill.receipts.some((r) => r.kind === "Settlement")) throw new ApiError(409, "The payer has already settled part of this bill");
      bill.set(set);
      bill.movedToPatient = 0;
      const plan = ratePlan ?? ((RATE_PLANS as readonly string[]).includes(String(body.ratePlan)) ? String(body.ratePlan) : "General");
      if (plan !== bill.ratePlan) {
        bill.ratePlan = plan as BDoc["ratePlan"];
        await reprice(bill);
        changes.push(`rate plan → ${plan}`);
      }
      changes.push(`payer → ${bill.payerType}${bill.payerName ? ` (${bill.payerName})` : ""}`);
    } else if ("ratePlan" in body) {
      if (bill.payerType !== "Self") fail({ ratePlan: "The payer decides the rate plan" });
      if (!(RATE_PLANS as readonly string[]).includes(String(body.ratePlan))) fail({ ratePlan: "Select a rate plan" });
      bill.ratePlan = String(body.ratePlan) as BDoc["ratePlan"];
      await reprice(bill);
      changes.push(`rate plan → ${bill.ratePlan}`);
    }
    if ("discount" in body) {
      const discount = r2(num(body.discount, 0));
      if (!(discount >= 0)) fail({ discount: "Enter a valid discount" });
      const reason = text(body.discountReason, 300);
      if (discount > 0 && reason.length < 3) fail({ discountReason: "Enter the reason for the discount" });
      bill.billDiscount = discount;
      bill.discountReason = discount > 0 ? reason : bill.discountReason;
      bill.discountApprovedBy = text(body.discountApprovedBy, 80) || undefined;
      recompute(bill);
      if (bill.billDiscount < discount) fail({ discount: `Discount cannot exceed ${money(bill.billDiscount + bill.taxableAmount)}` });
      changes.push(`bill discount ${money(discount)}${reason ? ` (${reason}${bill.discountApprovedBy ? `, approved by ${bill.discountApprovedBy}` : ""})` : ""}`);
    }
  }
  if (!changes.length) throw new ApiError(400, "Nothing to update");
  recompute(bill);
  await save(bill);
  await audit(req, user, bill, `Updated bill ${bill.code}: ${changes.join(", ")}`);
  return getBill(id);
}

/* ======================= actions ======================= */

export async function billAction(id: string, body: Record<string, unknown>, user: SessionUser, req: Request) {
  const bill = await loadBill(id);
  const action = String(body.action ?? "");
  const provisional = () => {
    if (bill.status !== "Provisional") throw new ApiError(409, bill.status === "Cancelled" ? "This bill is cancelled" : "The bill is final. Reopen it to change charges.");
  };
  const findLine = () => {
    const line = bill.lines.find((l) => String(l._id) === String(body.line));
    if (!line || line.status === "Cancelled") throw new ApiError(404, "Charge not found on this bill");
    return line;
  };
  let summary = "";
  let after: (() => Promise<string[]>) | null = null;

  switch (action) {
    case "add-lines": {
      provisional();
      const lines = await buildLines(body.lines, { ratePlan: bill.ratePlan, billType: bill.billType, admissionDate: bill.admissionDate, dischargeDate: bill.dischargeDate }, user);
      if (!lines.length) fail({ lines: "Add at least one charge" });
      if (live(bill).length + lines.length > MAX_LINES) fail({ lines: `At most ${MAX_LINES} charges per bill` });
      if (lines.some((l) => Number(l.discountPct) > 0) && !bill.discountReason && text(body.discountReason, 300).length < 3) fail({ discountReason: "Enter the reason for the discount" });
      if (text(body.discountReason, 300)) bill.discountReason = text(body.discountReason, 300);
      for (const l of lines) bill.lines.push(l);
      recompute(bill);
      summary = `Added ${lines.length} charge(s) to ${bill.code}: ${lines.map((l) => `${l.name} × ${l.qty}`).join(", ").slice(0, 400)}; net now ${money(bill.netAmount)}`;
      break;
    }
    case "update-line": {
      provisional();
      const line = findLine();
      const parts: string[] = [];
      if (body.qty !== undefined) {
        if (line.kind === "Inventory") throw new ApiError(409, "Issued stock quantities change through returns in Inventory");
        const qty = r2(num(body.qty));
        if (!(qty > 0 && qty <= 1000)) fail({ qty: "Quantity must be between 0.01 and 1000" });
        if (line.kind === "Package" && qty !== 1) fail({ qty: "Packages are billed once" });
        parts.push(`qty ${line.qty} → ${qty}`);
        line.qty = qty;
      }
      if (body.rate !== undefined) {
        const rate = r2(num(body.rate));
        if (!line.rateEditable) throw new ApiError(409, `${line.name}: the rate is fixed by the masters`);
        if (!(rate >= 0)) fail({ rate: "Enter a valid rate" });
        parts.push(`rate ${line.rate} → ${rate}`);
        line.rate = rate;
        line.rateOverridden = true;
      }
      if (body.discountPct !== undefined) {
        const pct = r2(num(body.discountPct, 0));
        if (!(pct >= 0 && pct <= 100)) fail({ discountPct: "Discount must be 0–100%" });
        if (pct > 0 && !bill.discountReason && text(body.discountReason, 300).length < 3) fail({ discountReason: "Enter the reason for the discount" });
        if (text(body.discountReason, 300)) bill.discountReason = text(body.discountReason, 300);
        parts.push(`discount ${line.discountPct ?? 0}% → ${pct}%`);
        line.discountPct = pct;
      }
      if (!parts.length) throw new ApiError(400, "Nothing to update");
      recompute(bill);
      summary = `Changed ${line.name} on ${bill.code}: ${parts.join(", ")}; net now ${money(bill.netAmount)}`;
      break;
    }
    case "cancel-line": {
      provisional();
      const line = findLine();
      if (line.kind === "Inventory") throw new ApiError(409, `This charge comes from stock issue ${line.sourceCode}. Return the items or cancel the issue in Inventory.`);
      const reason = text(body.reason, 300);
      if (reason.length < 3) fail({ reason: "Enter the reason for removing the charge" });
      line.status = "Cancelled";
      line.cancelledAt = new Date();
      line.cancelReason = reason;
      line.cancelledByName = user.name;
      recompute(bill);
      summary = `Removed ${line.name} (${money(line.amount)}) from ${bill.code}. Reason: ${reason}`;
      break;
    }
    case "receipt":
      summary = await applyReceipt(bill, body, user);
      break;
    case "finalize": {
      const opts = await applyFinalize(bill, body, user);
      summary = `Finalised bill ${bill.code}: net ${money(bill.netAmount)}, patient ${money(bill.patientShare)}${bill.payerShare ? `, ${bill.payerName} ${money(bill.payerShare)}` : ""}, due ${money(bill.patientDue)}`;
      after = () => afterFinalize(bill, opts, user);
      break;
    }
    case "reopen": {
      if (bill.status !== "Final" && bill.status !== "Closed") throw new ApiError(409, "Only final bills can be reopened");
      if (bill.receipts.some((r) => r.kind === "Settlement")) throw new ApiError(409, "The payer has already settled this bill; it cannot be reopened");
      const reason = text(body.reason, 300);
      if (reason.length < 3) fail({ reason: "Enter the reason for reopening" });
      bill.status = "Provisional";
      bill.finalizedAt = undefined;
      bill.finalizedByName = undefined;
      recompute(bill);
      summary = `Reopened final bill ${bill.code} for correction. Reason: ${reason}`;
      break;
    }
    case "cancel": {
      if (bill.status === "Cancelled") throw new ApiError(409, "Bill is already cancelled");
      if (bill.receipts.some((r) => r.kind === "Settlement")) throw new ApiError(409, "The payer has already settled this bill; it cannot be cancelled");
      const stock = live(bill).find((l) => l.kind === "Inventory");
      if (stock) throw new ApiError(409, `The bill carries charges from stock issue ${stock.sourceCode}. Cancel or return that issue in Inventory first.`);
      const reason = text(body.reason, 300);
      if (reason.length < 3) fail({ reason: "Enter the reason for cancelling" });
      bill.status = "Cancelled";
      bill.cancelledAt = new Date();
      bill.cancelReason = reason;
      bill.cancelledByName = user.name;
      recompute(bill);
      summary = `Cancelled bill ${bill.code} (${money(bill.netAmount)})${bill.refundDue > 0 ? ` — refund of ${money(bill.refundDue)} due` : ""}. Reason: ${reason}`;
      break;
    }
    default:
      throw new ApiError(400, "Unknown action");
  }

  await save(bill);
  const notes = after ? await after() : [];
  await audit(req, user, bill, notes.length ? `${summary}; ${notes.join("; ")}` : summary);
  return getBill(id);
}

/* ======================= receipts register & reconciliation ======================= */

export async function listReceipts(url: URL) {
  const { page, limit, skip } = parsePaging(url, 20);
  const match: Record<string, unknown> = {};
  const kind = url.searchParams.get("kind");
  if (kind && (RECEIPT_KINDS as readonly string[]).includes(kind)) match["receipts.kind"] = kind;
  const from = parseDay(url.searchParams.get("from"));
  const to = parseDay(url.searchParams.get("to"));
  if (from || to) match["receipts.at"] = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: new Date(to.getTime() + DAY - 1) } : {}) };
  const mode = url.searchParams.get("mode");
  if (mode) match["receipts.splits.mode"] = mode;
  const shift = url.searchParams.get("shift");
  if (shift && isObjectId(shift)) match["receipts.shift"] = new Types.ObjectId(shift);
  const q = url.searchParams.get("search")?.trim();
  if (q) {
    const rx = new RegExp(escapeRegex(q.slice(0, 60)), "i");
    match.$or = [{ "receipts.code": rx }, { code: rx }, { patientName: rx }, { patientCode: rx }];
  }
  const [res] = await Bill.aggregate<{ rows: Record<string, unknown>[]; count: { n: number }[]; totals: { _id: string; amount: number }[] }>([
    { $match: { receipts: { $ne: [] } } },
    { $project: { code: 1, patientName: 1, patientCode: 1, billType: 1, payerName: 1, receipts: 1 } },
    { $unwind: "$receipts" },
    { $match: match },
    { $sort: { "receipts.at": -1 } },
    { $facet: { rows: [{ $skip: skip }, { $limit: limit }], count: [{ $count: "n" }], totals: [{ $group: { _id: "$receipts.kind", amount: { $sum: "$receipts.amount" } } }] } },
  ]);
  const rows = res.rows.map((r) => {
    const rc = r.receipts as Record<string, unknown> & { splits: Record<string, unknown>[] };
    return {
      billId: String(r._id), billCode: r.code, patientName: r.patientName, patientCode: r.patientCode ?? null, billType: r.billType, payerName: r.payerName ?? null,
      id: String(rc._id), code: rc.code, kind: rc.kind, amount: rc.amount, writeOff: rc.writeOff ?? 0, toPatient: rc.toPatient ?? 0, reason: rc.reason ?? null, approvedBy: rc.approvedBy ?? null,
      at: (rc.at as Date).toISOString(), byName: rc.byName ?? null, shiftCode: rc.shiftCode ?? null,
      splits: rc.splits.map((s) => ({ id: String(s._id), mode: s.mode, amount: s.amount, reference: s.reference ?? null, recon: s.recon })),
    };
  });
  return { items: rows, pagination: pagination(page, limit, res.count[0]?.n ?? 0), totals: Object.fromEntries(res.totals.map((t) => [t._id, r2(t.amount)])) };
}

export async function listRecon(url: URL) {
  const { page, limit, skip } = parsePaging(url, 25);
  const match: Record<string, unknown> = { "receipts.splits.mode": { $ne: "Cash" } };
  const status = url.searchParams.get("status") ?? "Pending";
  if (status) match["receipts.splits.recon"] = status;
  const mode = url.searchParams.get("mode");
  if (mode && mode !== "Cash") match["receipts.splits.mode"] = mode;
  const from = parseDay(url.searchParams.get("from"));
  const to = parseDay(url.searchParams.get("to"));
  if (from || to) match["receipts.at"] = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: new Date(to.getTime() + DAY - 1) } : {}) };
  const [res] = await Bill.aggregate<{ rows: Record<string, unknown>[]; count: { n: number }[]; total: { amount: number }[] }>([
    { $match: { "receipts.splits.mode": { $in: ["Card", "UPI", "Bank Transfer", "Cheque"] } } },
    { $project: { code: 1, patientName: 1, receipts: 1 } },
    { $unwind: "$receipts" },
    { $unwind: "$receipts.splits" },
    { $match: match },
    { $sort: { "receipts.at": 1 } },
    { $facet: { rows: [{ $skip: skip }, { $limit: limit }], count: [{ $count: "n" }], total: [{ $group: { _id: null, amount: { $sum: "$receipts.splits.amount" } } }] } },
  ]);
  const rows = res.rows.map((r) => {
    const rc = r.receipts as Record<string, unknown> & { splits: Record<string, unknown> };
    const s = rc.splits;
    return {
      billId: String(r._id), billCode: r.code, patientName: r.patientName, receiptId: String(rc._id), receiptCode: rc.code, kind: rc.kind, at: (rc.at as Date).toISOString(), byName: rc.byName ?? null,
      splitId: String(s._id), mode: s.mode, amount: s.amount, reference: s.reference ?? null, recon: s.recon, reconAt: (s.reconAt as Date | undefined)?.toISOString() ?? null, reconByName: s.reconByName ?? null, reconNote: s.reconNote ?? null,
    };
  });
  return { items: rows, pagination: pagination(page, limit, res.count[0]?.n ?? 0), total: r2(res.total[0]?.amount ?? 0) };
}

export async function reconcile(body: Record<string, unknown>, user: SessionUser, req: Request) {
  const bill = await loadBill(String(body.bill ?? ""));
  const receipt = bill.receipts.find((r) => String(r._id) === String(body.receipt));
  const split = receipt?.splits.find((s) => String(s._id) === String(body.split));
  if (!receipt || !split) throw new ApiError(404, "Receipt not found");
  if (split.mode === "Cash") throw new ApiError(409, "Cash does not need reconciliation");
  const status = String(body.status ?? "");
  if (!["Reconciled", "Bounced", "Pending"].includes(status)) fail({ status: "Select the reconciliation result" });
  const note = text(body.note, 200);
  if (status === "Bounced" && note.length < 3) fail({ note: "Enter why the payment failed / bounced" });
  if (status === "Bounced" && receipt.kind === "Settlement" && bill.status === "Cancelled") throw new ApiError(409, "Bill is cancelled");
  const was = split.recon;
  split.recon = status as typeof split.recon;
  split.reconAt = status === "Pending" ? undefined : new Date();
  split.reconByName = status === "Pending" ? undefined : user.name;
  split.reconNote = note || (status === "Reconciled" ? undefined : split.reconNote);
  recompute(bill);
  await save(bill);
  await audit(req, user, bill, `${status === "Bounced" ? "Marked as bounced" : status === "Reconciled" ? "Reconciled" : "Reset reconciliation of"} ${split.mode} ${money(split.amount)} on ${receipt.code} (${bill.code}); was ${was}${note ? `. ${note}` : ""}${status === "Bounced" ? ` — due now ${money(bill.patientDue + bill.payerDue)}` : ""}`);
  return { recon: split.recon, billStatus: bill.status, patientDue: bill.patientDue };
}

/* ======================= cashier shifts ======================= */

async function shiftTotals(shiftId: Types.ObjectId) {
  const rows = await Bill.aggregate<{ _id: { kind: string; mode: string }; amount: number; n: number }>([
    { $match: { "receipts.shift": shiftId } },
    { $unwind: "$receipts" },
    { $match: { "receipts.shift": shiftId } },
    { $unwind: "$receipts.splits" },
    { $group: { _id: { kind: "$receipts.kind", mode: "$receipts.splits.mode" }, amount: { $sum: "$receipts.splits.amount" }, n: { $addToSet: "$receipts._id" } } },
    { $project: { amount: 1, n: { $size: "$n" } } },
  ]);
  const byMode = BILL_PAYMENT_MODES.map((mode) => {
    const of = (kinds: string[]) => r2(rows.filter((r) => r._id.mode === mode && kinds.includes(r._id.kind)).reduce((s, r) => s + r.amount, 0));
    const collected = of(["Advance", "Payment", "Settlement"]);
    const refunded = of(["Refund"]);
    return { mode, collected, refunded, net: r2(collected - refunded) };
  });
  const count = (kind: string) => rows.filter((r) => r._id.kind === kind).reduce((s, r) => s + r.n, 0);
  return {
    byMode,
    collected: r2(byMode.reduce((s, m) => s + m.collected, 0)),
    refunded: r2(byMode.reduce((s, m) => s + m.refunded, 0)),
    net: r2(byMode.reduce((s, m) => s + m.net, 0)),
    receipts: count("Advance") + count("Payment") + count("Settlement"),
    refunds: count("Refund"),
  };
}

function shiftOut(s: Record<string, unknown>) {
  return plain(s) as Record<string, unknown>;
}

export async function myShift(user: SessionUser) {
  const s = await Shift.findOne({ user: user.id, status: "Open" }).lean();
  if (!s) return null;
  const totals = await shiftTotals(s._id);
  const cash = totals.byMode.find((m) => m.mode === "Cash")!;
  return { ...shiftOut(s), totals, expectedCash: r2((s.openingCash ?? 0) + cash.net) };
}

export async function listShifts(url: URL) {
  const { page, limit, skip } = parsePaging(url, 15);
  const filter: Record<string, unknown> = { ...rangeFilter(url, "openedAt") };
  const status = url.searchParams.get("status");
  if (status) filter.status = status;
  const [docs, total] = await Promise.all([Shift.find(filter).sort({ openedAt: -1 }).skip(skip).limit(limit).lean(), Shift.countDocuments(filter)]);
  const rows = await Promise.all(docs.map(async (s) => ({ ...shiftOut(s), totals: s.status === "Open" ? await shiftTotals(s._id) : s.summary })));
  return { items: rows, pagination: pagination(page, limit, total) };
}

export async function getShift(id: string) {
  if (!isObjectId(id)) throw new ApiError(404, "Shift not found");
  const s = await Shift.findById(id).lean();
  if (!s) throw new ApiError(404, "Shift not found");
  const totals = s.status === "Open" ? await shiftTotals(s._id) : s.summary;
  const receipts = await listReceipts(new URL(`http://x/?shift=${id}&limit=100`));
  return { ...shiftOut(s), totals, receipts: receipts.items, hospital: hospitalInfo() };
}

export async function openShift(body: Record<string, unknown>, user: SessionUser, req: Request) {
  const counter = text(body.counter, 40) || "Main Cash Counter";
  const openingCash = r2(num(body.openingCash, 0));
  if (!(openingCash >= 0)) fail({ openingCash: "Enter the cash in the drawer" });
  if (await openShiftOf(user.id)) throw new ApiError(409, "You already have an open shift");
  await assertDayOpen();
  let s;
  try {
    s = await Shift.create({ code: await nextCode("SHF"), user: user.id, userName: user.name, counter, openedAt: new Date(), openingCash, status: "Open" });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) throw new ApiError(409, "You already have an open shift");
    throw err;
  }
  await logActivity({ req, user, action: "create", module: "billing", resource: "shifts", entityId: String(s._id), entityLabel: s.code, summary: `Opened cashier shift ${s.code} at ${counter} with ${money(openingCash)} opening cash` });
  return myShift(user);
}

export async function closeShift(id: string, body: Record<string, unknown>, user: SessionUser, req: Request) {
  if (!isObjectId(id)) throw new ApiError(404, "Shift not found");
  const s = await Shift.findById(id);
  if (!s) throw new ApiError(404, "Shift not found");
  if (s.status !== "Open") throw new ApiError(409, "Shift is already closed");
  if (String(s.user) !== user.id && user.role !== "super_admin") throw new ApiError(403, "Only the cashier who opened the shift (or the super admin) can close it");
  const counted = r2(num(body.countedCash));
  if (!(counted >= 0)) fail({ countedCash: "Enter the cash counted in the drawer" });
  const totals = await shiftTotals(s._id);
  const expected = r2((s.openingCash ?? 0) + totals.byMode.find((m) => m.mode === "Cash")!.net);
  const difference = r2(counted - expected);
  const notes = text(body.notes, 300);
  if (difference !== 0 && notes.length < 3) fail({ notes: `Cash is ${difference > 0 ? "over" : "short"} by ${money(Math.abs(difference))}. Explain the difference.` });
  Object.assign(s, { status: "Closed", closedAt: new Date(), closedByName: user.name, expectedCash: expected, countedCash: counted, difference, summary: totals, notes: notes || undefined, handoverTo: text(body.handoverTo, 80) || undefined });
  await s.save();
  await logActivity({
    req, user, action: "update", module: "billing", resource: "shifts", entityId: String(s._id), entityLabel: s.code,
    summary: `Closed shift ${s.code}: collected ${money(totals.collected)}, refunded ${money(totals.refunded)}, cash expected ${money(expected)}, counted ${money(counted)}${difference ? ` (${difference > 0 ? "excess" : "short"} ${money(Math.abs(difference))})` : ""}`,
  });
  return getShift(id);
}

/* ======================= daily cash closing ======================= */

export async function dayClosing(url: URL) {
  const date = parseDay(url.searchParams.get("date")) ?? todayUtc();
  const range = { $gte: date, $lte: new Date(date.getTime() + DAY - 1) };
  const [rows, shifts, lab, pharmacy, close] = await Promise.all([
    Bill.aggregate<{ _id: { kind: string; mode: string; by: string }; amount: number; n: { length: number } & unknown[] }>([
      { $match: { "receipts.at": range } },
      { $unwind: "$receipts" },
      { $match: { "receipts.at": range } },
      { $unwind: "$receipts.splits" },
      { $group: { _id: { kind: "$receipts.kind", mode: "$receipts.splits.mode", by: "$receipts.byName" }, amount: { $sum: "$receipts.splits.amount" }, n: { $addToSet: "$receipts._id" } } },
    ]),
    Shift.find({ $or: [{ openedAt: range }, { closedAt: range }, { status: "Open", openedAt: { $lte: range.$lte } }] }).sort({ openedAt: 1 }).lean(),
    LabOrder.aggregate<{ _id: { kind: string; mode: string }; amount: number }>([
      { $match: { "payments.at": range } },
      { $unwind: "$payments" },
      { $match: { "payments.at": range } },
      { $group: { _id: { kind: "$payments.kind", mode: "$payments.mode" }, amount: { $sum: "$payments.amount" } } },
    ]),
    Sale.aggregate<{ _id: string; amount: number }>([
      { $match: { billDate: range, status: { $ne: "Cancelled" } } },
      { $group: { _id: "$paymentMode", amount: { $sum: "$paidAmount" } } },
    ]),
    DayClose.findOne({ date }).lean(),
  ]);
  const sum = (f: (r: (typeof rows)[number]) => boolean) => r2(rows.filter(f).reduce((s, r) => s + r.amount, 0));
  const isIn = (k: string) => k !== "Refund";
  const byMode = BILL_PAYMENT_MODES.map((mode) => {
    const collected = sum((r) => r._id.mode === mode && isIn(r._id.kind));
    const refunded = sum((r) => r._id.mode === mode && !isIn(r._id.kind));
    return { mode, collected, refunded, net: r2(collected - refunded) };
  });
  const byKind = RECEIPT_KINDS.map((kind) => ({ kind, amount: sum((r) => r._id.kind === kind), count: new Set(rows.filter((r) => r._id.kind === kind).flatMap((r) => (r.n as unknown[]).map(String))).size }));
  const cashiers = [...new Set(rows.map((r) => r._id.by ?? "—"))].map((name) => ({
    name, collected: sum((r) => (r._id.by ?? "—") === name && isIn(r._id.kind)), refunded: sum((r) => (r._id.by ?? "—") === name && !isIn(r._id.kind)),
  }));
  const labByMode = [...new Set(lab.map((l) => l._id.mode))].map((mode) => ({
    mode, amount: r2(lab.filter((l) => l._id.mode === mode).reduce((s, l) => s + (l._id.kind === "Refund" ? -l.amount : l.amount), 0)),
  }));
  const summary = {
    byMode, byKind, cashiers,
    collected: r2(byMode.reduce((s, m) => s + m.collected, 0)),
    refunded: r2(byMode.reduce((s, m) => s + m.refunded, 0)),
    net: r2(byMode.reduce((s, m) => s + m.net, 0)),
    cashNet: byMode.find((m) => m.mode === "Cash")!.net,
  };
  return {
    date: date.toISOString().slice(0, 10),
    summary,
    shifts: await Promise.all(shifts.map(async (s) => ({ ...shiftOut(s), totals: s.status === "Open" ? await shiftTotals(s._id) : s.summary }))),
    departments: {
      laboratory: { byMode: labByMode, total: r2(labByMode.reduce((s, m) => s + m.amount, 0)) },
      pharmacy: { byMode: pharmacy.map((p) => ({ mode: p._id, amount: r2(p.amount) })), total: r2(pharmacy.reduce((s, p) => s + p.amount, 0)) },
    },
    closed: close ? plain(close) : null,
  };
}

export async function closeDay(body: Record<string, unknown>, user: SessionUser, req: Request) {
  const date = parseDay(body.date) ?? todayUtc();
  if (date > todayUtc()) fail({ date: "Cannot close a future day" });
  if (await DayClose.exists({ date })) throw new ApiError(409, "This day is already closed");
  const end = new Date(date.getTime() + DAY - 1);
  const open = await Shift.find({ status: "Open", openedAt: { $lte: end } }).select("code userName").lean();
  if (open.length) throw new ApiError(409, `Close these shifts first: ${open.map((s) => `${s.code} (${s.userName})`).join(", ")}`);
  const data = await dayClosing(new URL(`http://x/?date=${date.toISOString().slice(0, 10)}`));
  const deposited = body.cashDeposited === "" || body.cashDeposited === undefined || body.cashDeposited === null ? undefined : r2(num(body.cashDeposited));
  if (deposited !== undefined && !(deposited >= 0)) fail({ cashDeposited: "Enter a valid amount" });
  const doc = await DayClose.create({
    date, summary: { ...data.summary, departments: data.departments, shifts: data.shifts.map((s: Record<string, unknown>) => ({ code: s.code, userName: s.userName, counter: s.counter, countedCash: s.countedCash ?? null, difference: s.difference ?? null })) },
    cashDeposited: deposited, depositReference: text(body.depositReference, 60) || undefined, notes: text(body.notes, 300) || undefined, closedBy: user.id, closedByName: user.name,
  });
  await logActivity({
    req, user, action: "create", module: "billing", resource: "day_close", entityId: String(doc._id), entityLabel: data.date,
    summary: `Closed cash for ${data.date}: collected ${money(data.summary.collected)}, refunded ${money(data.summary.refunded)}, cash ${money(data.summary.cashNet)}${deposited !== undefined ? `, deposited ${money(deposited)}` : ""}`,
  });
  return dayClosing(new URL(`http://x/?date=${data.date}`));
}

export async function reopenDay(body: Record<string, unknown>, user: SessionUser, req: Request) {
  if (user.role !== "super_admin") throw new ApiError(403, "Only the super admin can reopen a closed day");
  const date = parseDay(body.date);
  if (!date) fail({ date: "Select the day" });
  const reason = text(body.reason, 300);
  if (reason.length < 3) fail({ reason: "Enter the reason for reopening" });
  const doc = await DayClose.findOneAndDelete({ date });
  if (!doc) throw new ApiError(404, "This day is not closed");
  await logActivity({ req, user, action: "delete", module: "billing", resource: "day_close", entityId: String(doc._id), entityLabel: date.toISOString().slice(0, 10), summary: `Reopened cash day ${date.toISOString().slice(0, 10)}. Reason: ${reason}` });
  return dayClosing(new URL(`http://x/?date=${date.toISOString().slice(0, 10)}`));
}

/* ======================= worklists ======================= */

/** Bills with money due: from patients (finalised) or from corporate / insurance payers. */
export async function dues(url: URL) {
  const party = url.searchParams.get("party") === "payer" ? "payer" : "patient";
  const includeRunning = url.searchParams.get("running") === "1";
  const filter: Record<string, unknown> =
    party === "payer"
      ? { payerDue: { $gt: 0 }, status: "Final" }
      : { patientDue: { $gt: 0 }, status: includeRunning ? { $in: ["Final", "Provisional"] } : "Final" };
  const payerType = url.searchParams.get("payerType");
  if (party === "payer" && payerType) filter.payerType = payerType;
  const q = url.searchParams.get("search")?.trim();
  if (q) {
    const rx = new RegExp(escapeRegex(q.slice(0, 60)), "i");
    filter.$or = [{ code: rx }, { patientName: rx }, { patientCode: rx }, { patientMobile: rx }, { payerName: rx }, { policyNo: rx }, { claimCode: rx }];
  }
  const bills = await Bill.find(filter).sort({ finalizedAt: 1, billDate: 1 }).limit(500).select("-receipts -lines").lean();
  const today = todayUtc().getTime();
  const rows = bills.map((b) => {
    const since = (b.finalizedAt ?? b.billDate).getTime();
    const ageDays = Math.max(0, Math.floor((today - since) / DAY));
    const dueDate = party === "payer" ? new Date(since + (b.creditDays ?? 30) * DAY) : null;
    return {
      ...billHeader(b as unknown as Record<string, unknown>), ageDays, balance: party === "payer" ? b.payerDue : b.patientDue,
      payerPaid: b.payerPaid, payerWriteOff: b.payerWriteOff, tpaName: b.tpaName ?? null, authNo: b.authNo ?? null,
      dueDate: dueDate?.toISOString() ?? null, overdue: dueDate ? dueDate.getTime() < today : ageDays > 30,
    };
  });
  const bucket = (min: number, max: number) => r2(rows.filter((r) => r.ageDays >= min && r.ageDays <= max).reduce((s, r) => s + r.balance, 0));
  return {
    party,
    rows,
    totals: {
      count: rows.length,
      balance: r2(rows.reduce((s, r) => s + r.balance, 0)),
      overdue: r2(rows.filter((r) => r.overdue).reduce((s, r) => s + r.balance, 0)),
      aging: [
        { label: "0–30 days", amount: bucket(0, 30) },
        { label: "31–60 days", amount: bucket(31, 60) },
        { label: "61–90 days", amount: bucket(61, 90) },
        { label: "90+ days", amount: bucket(91, Infinity) },
      ],
    },
  };
}

/** Admitted patients with their running bill, advance and departmental dues. */
export async function ipdBoard() {
  const admissions = await Admissions().find({ status: "Admitted" }).sort({ admissionDate: 1 }).limit(300).populate({ path: "doctor", select: "fullName" }).populate({ path: "patient", select: "fullName code mobile" }).lean<Doc[]>();
  const ids = admissions.map((a) => a._id);
  const [bills, pending] = await Promise.all([
    Bill.find({ admission: { $in: ids }, status: { $ne: "Cancelled" } }).select("-receipts -lines").lean(),
    // Discharged (or transferred) but the IPD bill is still provisional.
    Bill.find({ billType: "IPD", status: "Provisional", admission: { $nin: ids } }).select("-receipts -lines").lean(),
  ]);
  const patientIds = [...admissions.map((a) => (a.patient as Doc | null)?._id), ...pending.map((b) => b.patient)].filter(Boolean) as Types.ObjectId[];
  const [lab, sales] = await Promise.all([
    LabOrder.aggregate<{ _id: Types.ObjectId; due: number }>([
      { $match: { patient: { $in: patientIds }, paymentStatus: { $in: ["Unpaid", "Partially Paid"] } } },
      { $group: { _id: "$patient", due: { $sum: { $subtract: ["$netAmount", "$paidAmount"] } } } },
    ]),
    Sale.aggregate<{ _id: Types.ObjectId; due: number }>([
      { $match: { patient: { $in: patientIds }, status: { $in: ["Unpaid", "Partially Paid"] } } },
      { $group: { _id: "$patient", due: { $sum: { $subtract: ["$netAmount", "$paidAmount"] } } } },
    ]),
  ]);
  const deptDue = (pid: unknown) => r2((lab.find((l) => sameId(l._id, pid))?.due ?? 0) + (sales.find((s) => sameId(s._id, pid))?.due ?? 0));
  const billOut = (b: (typeof bills)[number] | undefined) =>
    b ? { id: String(b._id), code: b.code, status: b.status, netAmount: b.netAmount, patientPaid: b.patientPaid, patientDue: b.patientDue, payerType: b.payerType, payerName: b.payerName ?? null, paymentStatus: b.paymentStatus, advanceBalance: r2(Math.max(0, b.patientPaid - b.patientShare)) } : null;
  return {
    admitted: admissions.map((a) => {
      const p = a.patient as Doc | null;
      const own = bills.filter((b) => sameId(b.admission, a._id));
      return {
        admissionId: String(a._id), admissionCode: a.code, admissionDate: (a.admissionDate as Date)?.toISOString(), days: stayDays(a.admissionDate as Date), ward: a.ward, bed: a.bedNumber,
        doctor: ((a.doctor as Doc | null)?.fullName as string) ?? null, patientId: p ? String(p._id) : null, patientName: (p?.fullName as string) ?? "(deleted)", patientCode: (p?.code as string) ?? null,
        bill: billOut(own.find((b) => b.status === "Provisional") ?? own[0]), deptDue: deptDue(p?._id),
      };
    }),
    pending: pending.map((b) => ({ ...billOut(b)!, patientId: String(b.patient), patientName: b.patientName, patientCode: b.patientCode ?? null, admissionCode: b.admissionCode ?? null, admissionDate: b.admissionDate?.toISOString() ?? null, deptDue: deptDue(b.patient) })),
  };
}

export async function refundsDue() {
  const bills = await Bill.find({ refundDue: { $gt: 0 } }).sort({ updatedAt: 1 }).limit(300).select("-receipts -lines").lean();
  return { rows: bills.map((b) => ({ ...billHeader(b as unknown as Record<string, unknown>), cancelReason: b.cancelReason ?? null })), total: r2(bills.reduce((s, b) => s + b.refundDue, 0)) };
}

/* ======================= reports ======================= */

function reportRange(url: URL) {
  const today = todayUtc();
  const from = parseDay(url.searchParams.get("from")) ?? new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const to = parseDay(url.searchParams.get("to")) ?? today;
  if (from > to) throw new ApiError(422, "From date must be before To date");
  return { from, to, range: { $gte: from, $lte: new Date(to.getTime() + DAY - 1) } };
}

export async function billingSummary(url: URL) {
  const { from, to, range } = reportRange(url);
  const [bills, receipts] = await Promise.all([
    Bill.find({ billDate: range }).select("-receipts").sort({ billDate: 1, createdAt: 1 }).lean(),
    Bill.aggregate<{ kind: string; mode: string; amount: number; byName: string; at: Date; writeOff: number }>([
      { $match: { "receipts.at": range } },
      { $unwind: "$receipts" },
      { $match: { "receipts.at": range } },
      { $unwind: { path: "$receipts.splits", preserveNullAndEmptyArrays: true } },
      { $match: { "receipts.splits.recon": { $ne: "Bounced" } } },
      { $project: { _id: 0, kind: "$receipts.kind", mode: { $ifNull: ["$receipts.splits.mode", "—"] }, amount: { $ifNull: ["$receipts.splits.amount", 0] }, byName: "$receipts.byName", at: "$receipts.at", writeOff: "$receipts.writeOff" } },
    ]),
  ]);
  const liveBills = bills.filter((b) => b.status !== "Cancelled");
  const s = <T,>(arr: T[], f: (t: T) => number) => r2(arr.reduce((acc, x) => acc + (f(x) || 0), 0));
  const group = <T,>(arr: T[], key: (t: T) => string) => {
    const m = new Map<string, T[]>();
    for (const a of arr) m.set(key(a), [...(m.get(key(a)) ?? []), a]);
    return [...m.entries()];
  };
  const lines = liveBills.flatMap((b) => b.lines.filter((l) => l.status !== "Cancelled"));
  const inflow = receipts.filter((r) => r.kind !== "Refund");
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    totals: {
      bills: liveBills.length,
      cancelled: bills.length - liveBills.length,
      final: liveBills.filter((b) => b.status !== "Provisional").length,
      gross: s(liveBills, (b) => b.grossAmount),
      discount: s(liveBills, (b) => b.discountAmount),
      gst: s(liveBills, (b) => b.gstAmount),
      net: s(liveBills, (b) => b.netAmount),
      payerShare: s(liveBills, (b) => b.payerShare),
      collected: s(receipts.filter((r) => r.kind === "Advance" || r.kind === "Payment"), (r) => r.amount),
      settlements: s(receipts.filter((r) => r.kind === "Settlement"), (r) => r.amount),
      refunded: s(receipts.filter((r) => r.kind === "Refund"), (r) => r.amount),
      patientDue: s(liveBills.filter((b) => b.status !== "Provisional"), (b) => b.patientDue),
      payerDue: s(liveBills, (b) => b.payerDue),
    },
    byType: group(liveBills, (b) => b.billType).map(([label, bs]) => ({ label, bills: bs.length, net: s(bs, (b) => b.netAmount) })).sort((a, b) => b.net - a.net),
    byCategory: group(lines, (l) => l.category).map(([label, ls]) => ({ label, charges: ls.length, gross: s(ls, (l) => l.gross), discount: s(ls, (l) => l.discount), gst: s(ls, (l) => l.gst), amount: s(ls, (l) => l.amount) })).sort((a, b) => b.amount - a.amount),
    byMode: group(receipts, (r) => r.mode).map(([mode, rs]) => ({ mode, collected: s(rs.filter((r) => r.kind !== "Refund"), (r) => r.amount), refunded: s(rs.filter((r) => r.kind === "Refund"), (r) => r.amount) })),
    byCashier: group(receipts.filter((r) => r.kind !== "Settlement"), (r) => r.byName ?? "—").map(([name, rs]) => ({ name, collected: s(rs.filter((r) => r.kind !== "Refund"), (r) => r.amount), refunded: s(rs.filter((r) => r.kind === "Refund"), (r) => r.amount) })),
    byPayer: group(liveBills, (b) => (b.payerType === "Self" ? "Self pay" : `${b.payerName} (${b.payerType})`)).map(([label, bs]) => ({ label, bills: bs.length, net: s(bs, (b) => b.netAmount), payerShare: s(bs, (b) => b.payerShare), payerDue: s(bs, (b) => b.payerDue) })).sort((a, b) => b.net - a.net),
    gstSummary: group(lines.filter((l) => (l.gstRate ?? 0) > 0), (l) => String(l.gstRate)).map(([rate, ls]) => ({ rate: Number(rate), taxable: s(ls, (l) => l.taxable), cgst: r2(s(ls, (l) => l.gst) / 2), sgst: r2(s(ls, (l) => l.gst) / 2), gst: s(ls, (l) => l.gst) })),
    discounts: liveBills.filter((b) => b.discountAmount > 0).map((b) => ({ id: String(b._id), code: b.code, date: b.billDate.toISOString(), patient: b.patientName, gross: b.grossAmount, discount: b.discountAmount, reason: b.discountReason ?? "—", approvedBy: b.discountApprovedBy ?? "—", by: b.createdByName ?? "—" })),
    cancellations: bills.filter((b) => b.status === "Cancelled").map((b) => ({ id: String(b._id), code: b.code, date: b.billDate.toISOString(), patient: b.patientName, net: b.netAmount, reason: b.cancelReason ?? "—", by: b.cancelledByName ?? "—" })),
    writeOffs: s(receipts.filter((r) => r.kind === "Settlement"), (r) => r.writeOff),
    daily: group(liveBills, (b) => b.billDate.toISOString().slice(0, 10)).map(([date, bs]) => ({
      date, bills: bs.length, net: s(bs, (b) => b.netAmount), collected: s(inflow.filter((r) => r.at.toISOString().startsWith(date)), (r) => r.amount),
    })).sort((a, b) => a.date.localeCompare(b.date)),
    register: bills.map((b) => ({
      code: b.code, date: b.billDate.toISOString(), type: b.billType, patient: b.patientName, patientCode: b.patientCode ?? "", payer: b.payerType === "Self" ? "Self" : `${b.payerName}`,
      gross: b.grossAmount, discount: b.discountAmount, gst: b.gstAmount, net: b.netAmount, paid: b.patientPaid, patientDue: b.patientDue, payerDue: b.payerDue, status: b.status, paymentStatus: b.paymentStatus,
    })),
  };
}

export async function doctorFees(url: URL) {
  const { from, to, range } = reportRange(url);
  const [rows, payouts] = await Promise.all([
    Bill.aggregate<{ billId: Types.ObjectId; code: string; billDate: Date; patientName: string; doctor: Types.ObjectId; doctorName: string; feeType: string; qty: number; taxable: number; pct: number; status: string }>([
      { $match: { billDate: range, status: { $ne: "Cancelled" }, "lines.kind": "Doctor Fee" } },
      { $unwind: "$lines" },
      { $match: { "lines.kind": "Doctor Fee", "lines.status": { $ne: "Cancelled" } } },
      { $project: { _id: 0, billId: "$_id", code: 1, billDate: 1, patientName: 1, status: 1, doctor: "$lines.doctor", doctorName: "$lines.doctorName", feeType: "$lines.feeType", qty: "$lines.qty", taxable: "$lines.taxable", pct: { $ifNull: ["$lines.doctorSharePct", 0] } } },
      { $sort: { billDate: 1 } },
    ]),
    Payouts().find({ paymentDate: range }).lean<Doc[]>(),
  ]);
  const doctors = new Map<string, { id: string; name: string; services: number; billed: number; share: number; paid: number; byType: Record<string, number> }>();
  for (const r of rows) {
    const k = String(r.doctor);
    const d = doctors.get(k) ?? { id: k, name: r.doctorName, services: 0, billed: 0, share: 0, paid: 0, byType: {} };
    d.services += r.qty;
    d.billed = r2(d.billed + r.taxable);
    d.share = r2(d.share + (r.taxable * r.pct) / 100);
    d.byType[r.feeType] = r2((d.byType[r.feeType] ?? 0) + r.taxable);
    doctors.set(k, d);
  }
  for (const p of payouts) {
    const k = String(p.doctor);
    const d = doctors.get(k);
    if (d) d.paid = r2(d.paid + Number(p.amount ?? 0));
    else {
      const doc = await Doctors().findById(p.doctor).select("fullName").lean<Doc>();
      doctors.set(k, { id: k, name: (doc?.fullName as string) ?? "(deleted)", services: 0, billed: 0, share: 0, paid: Number(p.amount ?? 0), byType: {} });
    }
  }
  const list = [...doctors.values()].map((d) => ({ ...d, balance: r2(d.share - d.paid) })).sort((a, b) => b.billed - a.billed);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    doctors: list,
    totals: { billed: r2(list.reduce((s, d) => s + d.billed, 0)), share: r2(list.reduce((s, d) => s + d.share, 0)), paid: r2(list.reduce((s, d) => s + d.paid, 0)), balance: r2(list.reduce((s, d) => s + d.balance, 0)) },
    lines: rows.map((r) => ({ billId: String(r.billId), code: r.code, date: r.billDate.toISOString(), patient: r.patientName, doctor: r.doctorName, feeType: r.feeType, qty: r.qty, amount: r.taxable, sharePct: r.pct, share: r2((r.taxable * r.pct) / 100), status: r.status })),
  };
}

export const BILLING_REPORTS = {
  summary: billingSummary,
  dues,
  ipd: () => ipdBoard(),
  refunds: () => refundsDue(),
  "doctor-fees": doctorFees,
  closing: dayClosing,
  recon: listRecon,
} as const;

/* ======================= charges posted by other modules ======================= */

/**
 * The patient's running bill: the open bill of their (current) admission, or a
 * new provisional bill of `billType` (unsaved) when they are not admitted.
 */
async function runningBill(patient: Doc, admissionId: unknown, billType: (typeof BILL_TYPES)[number], note: string, user: SessionUser) {
  let admission: Doc | null = admissionId ? await Admissions().findById(admissionId).lean<Doc>() : null;
  if (!admission) admission = await Admissions().findOne({ patient: patient._id, status: "Admitted" }).sort({ admissionDate: -1 }).lean<Doc>();
  const open = admission ? ((await Bill.findOne({ admission: admission._id, status: "Provisional" })) as unknown as BDoc | null) : null;
  if (open) return { bill: open, created: false, preauth: null };
  const bill = new Bill({
    code: await nextCode("BILL"), billDate: todayUtc(), billType: admission ? "IPD" : billType,
    patient: patient._id, patientName: patient.fullName, patientCode: patient.code, patientGender: patient.gender, patientAge: ageYears(patient.dateOfBirth), patientMobile: patient.mobile,
    admission: admission?._id, admissionCode: admission?.code, admissionDate: admission?.admissionDate, wardBed: admission ? `${admission.ward} / ${admission.bedNumber}` : undefined,
    notes: note, createdBy: user.id, createdByName: user.name,
  }) as unknown as BDoc;
  // Like a bill opened at the counter, an admission with an approved cashless pre-auth bills the insurer.
  const preauth = admission ? await approvedPreauthPayer(admission._id) : null;
  if (preauth) {
    const { set, ratePlan } = await resolvePayer(preauth.payer);
    bill.set(set);
    bill.ratePlan = (ratePlan ?? "Insurance") as BDoc["ratePlan"];
  }
  return { bill, created: true, preauth };
}

/**
 * Ambulance trip charges go on the patient's running bill as one line per
 * charge head, tagged with the trip so the bill shows where they came from.
 */
export async function postAmbulanceCharges(
  input: { patient: Doc; tripId: Types.ObjectId; tripCode: string; billType: (typeof BILL_TYPES)[number]; lines: { name: string; detail?: string; amount: number }[] },
  user: SessionUser,
  req: Request
) {
  // A retried completion must not charge the trip twice.
  const already = await Bill.findOne({ lines: { $elemMatch: { sourceId: input.tripId, status: "Active" } } }).select("code").lean();
  if (already) return { id: already._id, code: already.code };
  const { bill, created, preauth } = await runningBill(input.patient, null, input.billType, `Opened automatically for ambulance trip ${input.tripCode}`, user);
  const now = new Date();
  for (const l of input.lines) {
    bill.lines.push({
      kind: "Ambulance", category: "Ambulance", name: l.name, detail: `${l.detail ? `${l.detail} · ` : ""}Trip ${input.tripCode}`, unit: "Per service",
      qty: 1, rate: r2(l.amount), gstRate: 0, discountPct: 0, sourceId: input.tripId, sourceCode: input.tripCode, addedAt: now, addedByName: user.name, status: "Active",
    });
  }
  recompute(bill);
  await save(bill);
  if (preauth) await linkPreauthBill(preauth.id, bill, user);
  await audit(req, user, bill, `${created ? "Opened provisional bill" : "Added ambulance charges to bill"} ${bill.code}: trip ${input.tripCode} ${money(input.lines.reduce((s, l) => s + l.amount, 0))}, net now ${money(bill.netAmount)}`, created ? "create" : "update");
  return { id: bill._id, code: bill.code };
}

/**
 * Inventory patient issues are charged at MRP (GST included) to the patient's
 * running bill: the open bill of their admission, or a new provisional bill.
 */
export async function postIssueCharges(
  input: { patient: Doc; admission?: unknown; sourceId: Types.ObjectId; sourceCode: string; lines: { lineId: unknown; itemName: string; batchNo?: string | null; qty: number; amount: number }[] },
  user: SessionUser,
  req: Request
) {
  const { bill, created, preauth } = await runningBill(input.patient, input.admission, "OPD", `Opened automatically for stock issue ${input.sourceCode}`, user);
  const now = new Date();
  for (const l of input.lines) {
    const qty = r2(l.qty);
    bill.lines.push({
      kind: "Inventory", category: "Pharmacy / Consumables", name: l.itemName, detail: `${l.batchNo ? `Batch ${l.batchNo} · ` : ""}Issue ${input.sourceCode}`, unit: "Per unit",
      qty, rate: qty > 0 ? r2(l.amount / qty) : 0, gstRate: 0, discountPct: 0, sourceId: input.sourceId, sourceLine: l.lineId as Types.ObjectId, sourceCode: input.sourceCode,
      addedAt: now, addedByName: user.name, status: "Active",
    });
  }
  recompute(bill);
  await save(bill);
  if (preauth) await linkPreauthBill(preauth.id, bill, user);
  await audit(req, user, bill, `${created ? "Opened provisional bill" : "Added stock issue to bill"} ${bill.code}: ${input.lines.length} item(s) from ${input.sourceCode}, net now ${money(bill.netAmount)}`, created ? "create" : "update");
  return { id: bill._id, code: bill.code };
}

/** Throws unless the issue's charges can still be removed (the bill must be provisional). */
export async function assertIssueChargesRemovable(billId: unknown, sourceId: unknown) {
  const bill = billId ? await Bill.findById(billId).select("code status lines.sourceId lines.status").lean() : null;
  if (!bill || bill.status === "Cancelled") return;
  if (!bill.lines.some((l) => sameId(l.sourceId, sourceId) && l.status !== "Cancelled")) return;
  if (bill.status !== "Provisional") throw new ApiError(409, `Bill ${bill.code} is already final. Reopen it in Billing before cancelling this issue.`);
}

/** Remove (cancel) an issue's charges, or reduce them for a return, on a provisional bill. */
export async function adjustIssueCharges(billId: unknown, sourceId: unknown, change: { cancel: true; reason: string } | { returns: { sourceLine: unknown; qty: number }[] }, user: SessionUser, req: Request) {
  const bill = billId ? ((await Bill.findById(billId)) as unknown as BDoc | null) : null;
  if (!bill || bill.status !== "Provisional") return null;
  const lines = live(bill).filter((l) => sameId(l.sourceId, sourceId));
  if (!lines.length) return null;
  const now = new Date();
  let summary: string;
  if ("cancel" in change) {
    for (const l of lines) Object.assign(l, { status: "Cancelled", cancelledAt: now, cancelReason: change.reason, cancelledByName: user.name });
    summary = `Removed ${lines.length} stock charge(s) of ${lines[0].sourceCode} from ${bill.code} (issue cancelled)`;
  } else {
    const parts: string[] = [];
    for (const r of change.returns) {
      const l = lines.find((x) => sameId(x.sourceLine, r.sourceLine));
      if (!l) continue;
      const qty = r2(l.qty - r.qty);
      if (qty <= 0) Object.assign(l, { status: "Cancelled", cancelledAt: now, cancelReason: "Returned to stock", cancelledByName: user.name });
      else l.qty = qty;
      parts.push(`${l.name} −${r.qty}`);
    }
    if (!parts.length) return null;
    summary = `Reduced stock charges on ${bill.code} for items returned: ${parts.join(", ")}`;
  }
  recompute(bill);
  await save(bill);
  await audit(req, user, bill, `${summary}; net now ${money(bill.netAmount)}`);
  return bill.code;
}
