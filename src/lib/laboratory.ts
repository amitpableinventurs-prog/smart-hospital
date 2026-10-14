import "server-only";
import { randomBytes } from "node:crypto";
import mongoose, { Types } from "mongoose";
import { ApiError, escapeRegex, pagination, parsePaging } from "./api";
import { logActivity } from "./audit";
import { r2 } from "./billing-math";
import { PAYMENT_MODES, RATE_PLANS } from "./modules";
import type { SessionUser } from "./session";
import { isObjectId, isValidEmail } from "./validation";
import { nextAccession, nextCode } from "@/models/Counter";
import { LabOrder, ORDER_SOURCES, PRIORITIES, REJECT_REASONS, type LabOrderDoc } from "@/models/laboratory";
import { getRecordModel } from "@/models/records";

type Doc = Record<string, unknown> & { _id: Types.ObjectId };
type OrderDoc = mongoose.HydratedDocument<LabOrderDoc>;
type ItemDoc = OrderDoc["items"][number];
type ResultRow = ItemDoc["results"][number];

const model = (m: string, r: string) => getRecordModel(m, r)!;
const Tests = () => model("laboratory", "tests");
const Categories = () => model("laboratory", "categories");
const Parameters = () => model("laboratory", "parameters");
const Profiles = () => model("laboratory", "profiles");
const Rates = () => model("laboratory", "rates");
const OutLabs = () => model("laboratory", "outsource_labs");
const Patients = () => model("patients", "patients");
const Doctors = () => model("doctors", "doctors");
const Visits = () => model("opd_ipd", "visits");
const Admissions = () => model("opd_ipd", "admissions");

const PHONE_RE = /^\+?[0-9][0-9\s-]{6,17}$/;
const SHARE_DAYS = 30;
const MAX_TESTS = 60;
/** Item states in which results may be entered or corrected. */
const RESULT_EDITABLE = ["Sample Received", "In Process", "Sent Out", "Result Entered", "Verified"];
const WORK_IN_PROGRESS = ["In Process", "Sent Out", "Result Entered", "Verified"];

/* ======================= helpers ======================= */

function todayUtc() {
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

function fail(errors: Record<string, string>, message = "Please correct the highlighted fields"): never {
  throw new ApiError(422, message, errors);
}

function text(v: unknown, max: number) {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

export function ageYears(dob: unknown, at = new Date()) {
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

export function labInfo() {
  return {
    name: process.env.HOSPITAL_NAME || "MediCare Hospital",
    department: process.env.LAB_NAME || "Department of Laboratory Medicine",
    address: process.env.HOSPITAL_ADDRESS || "",
    phone: process.env.HOSPITAL_PHONE || "",
    accreditation: process.env.LAB_ACCREDITATION || "",
  };
}

function paymentStatusOf(o: { status: string; netAmount: number; paidAmount: number }) {
  const paid = r2(o.paidAmount);
  if (o.status === "Cancelled") return paid > 0 ? "Refund Due" : "Cancelled";
  if (paid > r2(o.netAmount)) return "Refund Due";
  if (paid >= r2(o.netAmount)) return "Paid";
  return paid > 0 ? "Partially Paid" : "Unpaid";
}

/** Re-derive billing totals and the order status from its items and payments. */
function recompute(order: OrderDoc) {
  const live = order.items.filter((i) => i.status !== "Cancelled");
  order.grossAmount = r2(live.reduce((s, i) => s + i.price, 0));
  order.discount = Math.min(order.discount ?? 0, order.grossAmount);
  order.netAmount = r2(order.grossAmount - order.discount);
  order.paidAmount = r2(order.payments.reduce((s, p) => s + (p.kind === "Refund" ? -p.amount : p.amount), 0));

  const approved = live.filter((i) => i.status === "Approved").length;
  if (live.length === 0) order.status = "Cancelled";
  else if (approved === live.length) order.status = "Reported";
  else if (approved > 0) order.status = "Partially Reported";
  else if (live.some((i) => WORK_IN_PROGRESS.includes(i.status))) order.status = "In Process";
  else if (live.every((i) => i.status !== "Ordered")) order.status = "Sample Collected";
  else order.status = "Registered";
  if (order.status === "Reported" && !order.reportedAt) order.reportedAt = new Date();
  if (order.status !== "Reported") order.reportedAt = undefined;
  order.paymentStatus = paymentStatusOf(order);
}

async function save(order: OrderDoc) {
  try {
    await order.save();
  } catch (err) {
    if (err instanceof mongoose.Error.VersionError) throw new ApiError(409, "This order was just updated by someone else. Refresh and try again.");
    throw err;
  }
}

async function loadOrder(id: string) {
  if (!isObjectId(id)) throw new ApiError(404, "Lab order not found");
  const order = await LabOrder.findById(id);
  if (!order) throw new ApiError(404, "Lab order not found");
  return order as unknown as OrderDoc;
}

function audit(req: Request, user: SessionUser, order: { _id: unknown; code: string }, summary: string, action: "create" | "update" = "update") {
  return logActivity({ req, user, action, module: "laboratory", resource: "orders", entityId: String(order._id), entityLabel: order.code, summary });
}

/* ======================= reference ranges & flags ======================= */

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Pick the range that applies to this patient: child → gender → general. */
function resolveRange(p: Doc, gender?: string | null, age?: number | null) {
  const pair = (lo: string, hi: string) => (isNum(p[lo]) || isNum(p[hi]) ? { low: isNum(p[lo]) ? p[lo] : undefined, high: isNum(p[hi]) ? p[hi] : undefined } : null);
  const childAge = isNum(p.childAgeBelow) ? p.childAgeBelow : 12;
  return (
    (age != null && age < childAge ? pair("childLow", "childHigh") : null) ??
    (gender === "Male" ? pair("maleLow", "maleHigh") : gender === "Female" ? pair("femaleLow", "femaleHigh") : null) ??
    pair("low", "high") ?? { low: undefined, high: undefined }
  );
}

export function rangeLabel(r: { low?: number | null; high?: number | null; rangeText?: string | null; normalValue?: string | null }) {
  if (r.rangeText) return r.rangeText;
  if (isNum(r.low) && isNum(r.high)) return `${r.low} – ${r.high}`;
  if (isNum(r.low)) return `≥ ${r.low}`;
  if (isNum(r.high)) return `≤ ${r.high}`;
  return r.normalValue ?? "";
}

function flagFor(row: ResultRow, value: string, n: number | undefined) {
  if (row.resultType === "Numeric" && n !== undefined) {
    if (isNum(row.criticalLow) && n < row.criticalLow) return "LL";
    if (isNum(row.criticalHigh) && n > row.criticalHigh) return "HH";
    if (isNum(row.low) && n < row.low) return "L";
    if (isNum(row.high) && n > row.high) return "H";
    return "";
  }
  return row.normalValue && value.toLowerCase() !== row.normalValue.toLowerCase() ? "A" : "";
}

/** Result rows for an item: its saved snapshot, else built from the parameter master. */
async function templateRows(item: { test: unknown; testName: string; results?: unknown[] }, gender?: string | null, age?: number | null) {
  if (item.results && item.results.length) return item.results as ResultRow[];
  const params = await Parameters().find({ test: item.test }).sort({ sortOrder: 1, createdAt: 1 }).lean<Doc[]>();
  if (params.length === 0) return [{ name: item.testName, resultType: "Text", sortOrder: 1 } as ResultRow];
  return params.map((p) => {
    const { low, high } = resolveRange(p, gender, age);
    return {
      parameter: p._id, name: String(p.name), unit: (p.unit as string) ?? undefined, resultType: (p.resultType as "Numeric" | "Text" | "Options") ?? "Numeric",
      options: (p.options as string) ?? undefined, normalValue: (p.normalValue as string) ?? undefined, decimals: isNum(p.decimals) ? p.decimals : undefined,
      low, high, criticalLow: isNum(p.criticalLow) ? p.criticalLow : undefined, criticalHigh: isNum(p.criticalHigh) ? p.criticalHigh : undefined,
      rangeText: (p.rangeText as string) ?? undefined, sortOrder: isNum(p.sortOrder) ? p.sortOrder : 10, flag: "",
    } as ResultRow;
  });
}

/* ======================= catalog & patient context ======================= */

async function planRates(testIds: unknown[], plan: string) {
  const now = new Date();
  const rows = await Rates()
    .find({ test: { $in: testIds }, ratePlan: plan, status: "Active", $or: [{ effectiveFrom: null }, { effectiveFrom: { $exists: false } }, { effectiveFrom: { $lte: now } }] })
    .lean<Doc[]>();
  return new Map(rows.map((r) => [String(r.test), Number(r.rate)]));
}

/** Bookable tests and profiles priced for a rate plan; `ids` re-prices specific tests. */
export async function catalog(q: string, plan: string, ids: string[] = []) {
  const ratePlan = (RATE_PLANS as readonly string[]).includes(plan) ? plan : "General";
  const rx = q ? new RegExp(escapeRegex(q.slice(0, 60)), "i") : null;
  const byId = ids.filter(isObjectId).slice(0, 100);
  const [tests, profiles] = await Promise.all([
    Tests()
      .find(byId.length ? { _id: { $in: byId } } : { status: "Active", ...(rx ? { $or: [{ testName: rx }, { testCode: rx }] } : {}) })
      .sort({ testName: 1 }).limit(byId.length || 20).populate({ path: "category", select: "name" }).lean<Doc[]>(),
    byId.length ? Promise.resolve([] as Doc[]) : Profiles().find({ status: "Active", ...(rx ? { $or: [{ name: rx }, { code: rx }] } : {}) }).sort({ name: 1 }).limit(10).populate({ path: "tests", select: "testName testCode status" }).lean<Doc[]>(),
  ]);
  const rates = await planRates(tests.map((t) => t._id), ratePlan);
  return {
    tests: tests.map((t) => ({
      id: String(t._id), name: String(t.testName), code: String(t.testCode ?? ""), category: ((t.category as Doc | null)?.name as string) ?? "",
      sampleType: (t.sampleType as string) ?? "", container: (t.container as string) ?? "", rate: rates.get(String(t._id)) ?? Number(t.price ?? 0),
      outsourced: !!t.outsourceLab, turnaroundHours: (t.turnaroundHours as number) ?? null, preparation: (t.patientPreparation as string) ?? null,
    })),
    profiles: profiles.map((p) => ({
      id: String(p._id), name: String(p.name), code: String(p.code ?? ""), rate: Number(p.price ?? 0),
      tests: ((p.tests as Doc[] | undefined) ?? []).filter((t) => t && t.status === "Active").map((t) => ({ id: String(t._id), name: String(t.testName), code: String(t.testCode ?? "") })),
    })),
  };
}

export async function patientContext(patientId: string) {
  if (!isObjectId(patientId)) throw new ApiError(404, "Patient not found");
  const p = await Patients().findById(patientId).select("fullName code gender dateOfBirth mobile").lean<Doc>();
  if (!p) throw new ApiError(404, "Patient not found");
  const since = new Date(todayUtc().getTime() - 30 * 86400_000);
  const [visits, admissions] = await Promise.all([
    Visits().find({ patient: p._id, visitDate: { $gte: since }, status: { $ne: "Cancelled" } }).sort({ visitDate: -1 }).limit(10).populate({ path: "doctor", select: "fullName code" }).lean<Doc[]>(),
    Admissions().find({ patient: p._id, status: "Admitted" }).sort({ admissionDate: -1 }).limit(5).populate({ path: "doctor", select: "fullName code" }).lean<Doc[]>(),
  ]);
  const doc = (d: unknown) => (d && typeof d === "object" ? { id: String((d as Doc)._id), label: String((d as Doc).fullName), code: (d as Doc).code as string } : null);
  return {
    patient: { id: String(p._id), name: String(p.fullName), code: (p.code as string) ?? "", gender: (p.gender as string) ?? "", age: ageYears(p.dateOfBirth) ?? null, mobile: (p.mobile as string) ?? "" },
    visits: visits.map((v) => ({ id: String(v._id), code: String(v.code), date: (v.visitDate as Date)?.toISOString(), department: (v.department as string) ?? "", status: v.status, doctor: doc(v.doctor) })),
    admissions: admissions.map((a) => ({ id: String(a._id), code: String(a.code), date: (a.admissionDate as Date)?.toISOString(), ward: a.ward, bed: a.bedNumber, doctor: doc(a.doctor) })),
  };
}

/* ======================= booking (registration) ======================= */

export async function createOrder(body: Record<string, unknown>, user: SessionUser, req: Request) {
  const errors: Record<string, string> = {};

  let patient: Doc | null = null;
  if (!isObjectId(body.patient)) errors.patient = "Select the patient";
  else if (!(patient = await Patients().findById(body.patient).lean<Doc>())) errors.patient = "Patient not found";

  const source = String(body.source ?? "");
  if (!(ORDER_SOURCES as readonly string[]).includes(source)) errors.source = "Select OPD, IPD or walk-in";
  const priority = (PRIORITIES as readonly string[]).includes(String(body.priority)) ? String(body.priority) : "Routine";
  const ratePlan = (RATE_PLANS as readonly string[]).includes(String(body.ratePlan)) ? String(body.ratePlan) : "General";

  let visit: Doc | null = null;
  let admission: Doc | null = null;
  if (patient && source === "OPD" && body.visit) {
    visit = isObjectId(body.visit) ? await Visits().findById(body.visit).lean<Doc>() : null;
    if (!visit || String(visit.patient) !== String(patient._id)) errors.visit = "Select an OPD visit of this patient";
  }
  if (patient && source === "IPD") {
    admission = isObjectId(body.admission) ? await Admissions().findById(body.admission).lean<Doc>() : null;
    if (!admission || String(admission.patient) !== String(patient._id)) errors.admission = "Select the patient's current admission";
    else if (admission.status !== "Admitted") errors.admission = `Admission ${admission.code} is ${String(admission.status).toLowerCase()}`;
  }

  let doctor: Doc | null = null;
  const doctorId = body.doctor || visit?.doctor || admission?.doctor;
  if (doctorId) {
    doctor = isObjectId(String(doctorId)) ? await Doctors().findById(doctorId).lean<Doc>() : null;
    if (!doctor) errors.doctor = "Doctor not found";
  }

  const testIds = (Array.isArray(body.tests) ? body.tests : []).filter(isObjectId);
  const profileIds = (Array.isArray(body.profiles) ? body.profiles : []).filter(isObjectId);
  if (testIds.length + profileIds.length === 0) errors.tests = "Add at least one test or profile";
  if (Object.keys(errors).length) fail(errors);

  const profiles = await Profiles().find({ _id: { $in: profileIds }, status: "Active" }).lean<Doc[]>();
  if (profiles.length !== new Set(profileIds).size) fail({ tests: "A selected profile is inactive or no longer exists" });
  const allTestIds = [...new Set([...testIds, ...profiles.flatMap((p) => ((p.tests as unknown[]) ?? []).map(String))])];
  const tests = await Tests().find({ _id: { $in: allTestIds }, status: "Active" }).lean<Doc[]>();
  const testMap = new Map(tests.map((t) => [String(t._id), t]));
  for (const id of testIds) if (!testMap.has(id)) fail({ tests: "A selected test is inactive or no longer exists" });

  const [categories, labs, rates] = await Promise.all([
    Categories().find({ _id: { $in: tests.map((t) => t.category) } }).lean<Doc[]>(),
    OutLabs().find({ _id: { $in: tests.map((t) => t.outsourceLab).filter(Boolean) } }).lean<Doc[]>(),
    planRates(allTestIds, ratePlan),
  ]);
  const catMap = new Map(categories.map((c) => [String(c._id), c]));
  const labMap = new Map(labs.map((l) => [String(l._id), l]));
  const rateOf = (t: Doc) => rates.get(String(t._id)) ?? Number(t.price ?? 0);

  const seen = new Map<string, string>();
  const lines: Record<string, unknown>[] = [];
  const addLine = (t: Doc, price: number, profile?: Doc) => {
    const id = String(t._id);
    const where = profile ? `profile ${profile.name}` : "the test list";
    if (seen.has(id)) fail({ tests: `${t.testName} is added twice (${seen.get(id)} and ${where})` });
    seen.set(id, where);
    const cat = catMap.get(String(t.category));
    const lab = t.outsourceLab ? labMap.get(String(t.outsourceLab)) : undefined;
    lines.push({
      test: t._id, testName: t.testName, testCode: t.testCode, category: t.category, categoryName: cat?.name ?? "Other", categoryOrder: Number(cat?.sortOrder ?? 10),
      method: t.method, sampleType: t.sampleType, container: t.container, reportType: t.reportType ?? "Parametric",
      profile: profile?._id, profileName: profile?.name, price: r2(price), status: "Ordered",
      outsourceLab: lab?._id, outsourceLabName: lab?.name,
    });
  };

  for (const p of profiles) {
    const members = ((p.tests as unknown[]) ?? []).map((id) => testMap.get(String(id))).filter((t): t is Doc => !!t);
    if (members.length === 0) fail({ tests: `Profile ${p.name} has no active tests` });
    // Split the package rate across its tests in proportion to their own rates.
    const base = members.map(rateOf);
    const total = base.reduce((s, b) => s + b, 0);
    const price = Number(p.price ?? 0);
    let allocated = 0;
    members.forEach((t, i) => {
      const share = i === members.length - 1 ? r2(price - allocated) : r2(total > 0 ? (price * base[i]) / total : price / members.length);
      allocated = r2(allocated + share);
      addLine(t, share, p);
    });
  }
  for (const id of testIds) addLine(testMap.get(id)!, rateOf(testMap.get(id)!));
  if (lines.length > MAX_TESTS) fail({ tests: `At most ${MAX_TESTS} tests per registration` });

  // One sample (accession no.) per sample type + container.
  const samples: Record<string, unknown>[] = [];
  const byKey = new Map<string, string>();
  for (const l of lines) {
    const key = `${l.sampleType}|${l.container}`;
    if (!byKey.has(key)) {
      const accessionNo = await nextAccession();
      byKey.set(key, accessionNo);
      samples.push({ accessionNo, sampleType: l.sampleType, container: l.container, status: "Pending" });
    }
    l.sampleNo = byKey.get(key);
  }

  const gross = r2(lines.reduce((s, l) => s + Number(l.price), 0));
  const discount = r2(num(body.discount, 0));
  if (!(discount >= 0 && discount <= gross)) fail({ discount: `Discount must be between 0 and ${gross}` });
  const net = r2(gross - discount);
  const paid = r2(num(body.paidAmount, 0));
  if (!(paid >= 0 && paid <= net)) fail({ paidAmount: `Amount received must be between 0 and ${net}` });
  const mode = String(body.paymentMode ?? "");
  if (paid > 0 && (!(PAYMENT_MODES as readonly string[]).includes(mode) || mode === "Credit")) fail({ paymentMode: "Select how the payment was received" });

  const now = new Date();
  const order = new LabOrder({
    code: await nextCode("LAB"),
    orderDate: now,
    patient: patient!._id, patientName: patient!.fullName, patientCode: patient!.code, patientGender: patient!.gender,
    patientDob: patient!.dateOfBirth, patientAge: ageYears(patient!.dateOfBirth, now), patientMobile: patient!.mobile,
    source, visit: visit?._id, visitCode: visit?.code, admission: admission?._id, admissionCode: admission?.code,
    wardBed: admission ? `${admission.ward} / ${admission.bedNumber}` : undefined,
    doctor: doctor?._id, doctorName: doctor?.fullName, doctorPhone: doctor?.phone, doctorEmail: doctor?.email,
    priority, ratePlan, clinicalNotes: text(body.clinicalNotes, 500) || undefined,
    items: lines, samples, discount,
    payments: paid > 0 ? [{ kind: "Payment", amount: paid, mode, reference: text(body.paymentReference, 60) || undefined, byName: user.name }] : [],
    createdBy: user.id, createdByName: user.name,
  }) as unknown as OrderDoc;
  recompute(order);
  await save(order);
  await audit(req, user, order, `Registered lab order ${order.code} for ${order.patientName} (${source}) — ${lines.length} test${lines.length === 1 ? "" : "s"}, ₹${net}${paid ? `, received ₹${paid} ${mode}` : ""}`, "create");
  return order;
}

/* ======================= order detail & lists ======================= */

export async function getOrder(id: string) {
  const order = await loadOrder(id);
  const out = plain(order.toObject()) as Record<string, unknown>;
  // Result-entry templates for items that have no results yet.
  const templates: Record<string, unknown> = {};
  for (const item of order.items) {
    if (RESULT_EDITABLE.includes(item.status) && item.results.length === 0) {
      templates[String(item._id)] = plain(await templateRows(item, order.patientGender, order.patientAge));
    }
  }
  return { ...out, templates, lab: labInfo() };
}

function listFilter(url: URL) {
  const filter: Record<string, unknown> = {};
  const q = url.searchParams.get("search")?.trim();
  if (q) {
    const rx = new RegExp(escapeRegex(q.slice(0, 60)), "i");
    filter.$or = [{ code: rx }, { patientName: rx }, { patientCode: rx }, { patientMobile: rx }, { doctorName: rx }, { "samples.accessionNo": q }];
  }
  for (const key of ["status", "source", "priority", "paymentStatus"]) {
    const v = url.searchParams.get(key);
    if (v) filter[key] = v;
  }
  const patient = url.searchParams.get("patient");
  if (patient && isObjectId(patient)) filter.patient = new Types.ObjectId(patient);
  const from = parseDay(url.searchParams.get("from"));
  const to = parseDay(url.searchParams.get("to"));
  if (from || to) filter.orderDate = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: new Date(to.getTime() + 86400_000 - 1) } : {}) };
  return filter;
}

export function orderHeader(d: Record<string, unknown>) {
  const items = (d.items as { testCode?: string; testName: string; status: string; critical?: boolean; abnormal?: boolean }[]) ?? [];
  const live = items.filter((i) => i.status !== "Cancelled");
  return {
    id: String(d._id), code: d.code, orderDate: (d.orderDate as Date)?.toISOString(), patient: String(d.patient), patientName: d.patientName, patientCode: d.patientCode,
    patientAge: d.patientAge ?? null, patientGender: d.patientGender ?? null, source: d.source, doctorName: d.doctorName ?? null, priority: d.priority,
    status: d.status, paymentStatus: d.paymentStatus, netAmount: d.netAmount, paidAmount: d.paidAmount,
    tests: live.length, approved: live.filter((i) => i.status === "Approved").length,
    testCodes: live.map((i) => i.testCode || i.testName),
    critical: live.some((i) => i.critical), abnormal: live.some((i) => i.abnormal),
    createdByName: d.createdByName ?? null,
  };
}

export async function listOrders(url: URL) {
  const { page, limit, skip } = parsePaging(url, 15);
  const filter = listFilter(url);
  const [docs, total] = await Promise.all([
    LabOrder.find(filter).sort({ orderDate: -1 }).skip(skip).limit(limit).select("-items.results -payments -shares -samples").lean(),
    LabOrder.countDocuments(filter),
  ]);
  return { items: docs.map((d) => orderHeader(d as unknown as Record<string, unknown>)), pagination: pagination(page, limit, total) };
}

export async function listSamples(url: URL) {
  const { page, limit, skip } = parsePaging(url, 20);
  const base: Record<string, unknown> = { status: { $ne: "Cancelled" } };
  const sampleMatch: Record<string, unknown> = {};
  const status = url.searchParams.get("status");
  if (status) sampleMatch["samples.status"] = status;
  const q = url.searchParams.get("search")?.trim();
  if (q) {
    const rx = new RegExp(escapeRegex(q.slice(0, 60)), "i");
    sampleMatch.$or = [{ "samples.accessionNo": q }, { code: rx }, { patientName: rx }, { patientCode: rx }];
  }
  const [res] = await LabOrder.aggregate<{ rows: Record<string, unknown>[]; count: { n: number }[] }>([
    { $match: base },
    { $project: { code: 1, orderDate: 1, priority: 1, patientName: 1, patientCode: 1, patientAge: 1, patientGender: 1, source: 1, wardBed: 1, samples: 1, "items.sampleNo": 1, "items.testCode": 1, "items.testName": 1, "items.status": 1 } },
    { $unwind: "$samples" },
    { $match: sampleMatch },
    { $addFields: { prio: { $indexOfArray: [["STAT", "Urgent", "Routine"], "$priority"] } } },
    { $sort: { prio: 1, orderDate: 1 } },
    { $facet: { rows: [{ $skip: skip }, { $limit: limit }], count: [{ $count: "n" }] } },
  ]);
  const rows = res.rows.map((r) => {
    const s = r.samples as Record<string, unknown>;
    const items = (r.items as { sampleNo?: string; testCode?: string; testName: string; status: string }[]).filter((i) => i.sampleNo === s.accessionNo && i.status !== "Cancelled");
    return {
      orderId: String(r._id), labNo: r.code, orderDate: (r.orderDate as Date).toISOString(), priority: r.priority, source: r.source, wardBed: r.wardBed ?? null,
      patientName: r.patientName, patientCode: r.patientCode, patientAge: r.patientAge ?? null, patientGender: r.patientGender ?? null,
      sampleId: String(s._id), accessionNo: s.accessionNo, sampleType: s.sampleType, container: s.container, status: s.status,
      collectedAt: (s.collectedAt as Date | undefined)?.toISOString() ?? null, receivedAt: (s.receivedAt as Date | undefined)?.toISOString() ?? null,
      rejectReason: s.rejectReason ?? null, recollectOf: s.recollectOf ?? null, tests: items.map((i) => i.testCode || i.testName),
    };
  });
  return { items: rows, pagination: pagination(page, limit, res.count[0]?.n ?? 0) };
}

/* ======================= samples ======================= */

export async function sampleAction(orderId: string, sampleId: string, body: Record<string, unknown>, user: SessionUser, req: Request) {
  const order = await loadOrder(orderId);
  if (order.status === "Cancelled") throw new ApiError(409, "This order is cancelled");
  const sample = order.samples.find((s) => String(s._id) === sampleId);
  if (!sample) throw new ApiError(404, "Sample not found");
  const linked = order.items.filter((i) => i.sampleNo === sample.accessionNo && i.status !== "Cancelled");
  const now = new Date();
  const action = String(body.action ?? "");
  let summary = "";

  if (action === "collect") {
    if (sample.status !== "Pending") throw new ApiError(409, `Sample ${sample.accessionNo} is already ${sample.status.toLowerCase()}`);
    sample.status = "Collected";
    sample.collectedAt = now;
    sample.collectedByName = user.name;
    for (const i of linked) if (i.status === "Ordered") i.status = "Sample Collected";
    summary = `Collected sample ${sample.accessionNo} (${sample.sampleType}) for ${order.code}`;
  } else if (action === "receive") {
    if (sample.status !== "Collected") throw new ApiError(409, sample.status === "Pending" ? "Collect the sample before receiving it in the lab" : `Sample is already ${sample.status.toLowerCase()}`);
    sample.status = "Received";
    sample.receivedAt = now;
    sample.receivedByName = user.name;
    for (const i of linked) if (i.status === "Sample Collected") i.status = "Sample Received";
    summary = `Received sample ${sample.accessionNo} in the lab for ${order.code}`;
  } else if (action === "reject") {
    const reason = String(body.reason ?? "");
    const note = text(body.note, 200);
    if (!(REJECT_REASONS as readonly string[]).includes(reason)) fail({ reason: "Select a rejection reason" });
    if (reason === "Other" && note.length < 3) fail({ note: "Describe the reason" });
    if (sample.status !== "Collected" && sample.status !== "Received") throw new ApiError(409, "Only collected or received samples can be rejected");
    const done = linked.find((i) => !["Ordered", "Sample Collected", "Sample Received", "In Process"].includes(i.status));
    if (done) throw new ApiError(409, `${done.testName} is already ${done.status.toLowerCase()}; reopen or cancel it before rejecting the sample.`);
    const accessionNo = await nextAccession();
    sample.status = "Rejected";
    sample.rejectedAt = now;
    sample.rejectedByName = user.name;
    sample.rejectReason = note ? `${reason}: ${note}` : reason;
    sample.replacedBy = accessionNo;
    order.samples.push({ accessionNo, sampleType: sample.sampleType, container: sample.container, status: "Pending", recollectOf: sample.accessionNo });
    for (const i of linked) {
      i.status = "Ordered";
      i.sampleNo = accessionNo;
      i.processingAt = undefined;
    }
    summary = `Rejected sample ${sample.accessionNo} (${sample.rejectReason}) for ${order.code}; recollection ${accessionNo} requested`;
  } else {
    throw new ApiError(400, "Unknown sample action");
  }
  recompute(order);
  await save(order);
  await audit(req, user, order, summary);
  return getOrder(orderId);
}

/* ======================= tests: processing → results → approval ======================= */

export async function itemAction(orderId: string, itemId: string, body: Record<string, unknown>, user: SessionUser, req: Request) {
  const order = await loadOrder(orderId);
  const item = order.items.find((i) => String(i._id) === itemId);
  if (!item) throw new ApiError(404, "Test not found on this order");
  const action = String(body.action ?? "");
  const now = new Date();
  const need = (states: string[], what: string) => {
    if (!states.includes(item.status)) throw new ApiError(409, `${item.testName} is ${item.status.toLowerCase()} — cannot ${what}`);
  };
  let summary = "";

  switch (action) {
    case "process":
      need(["Sample Received"], "start processing");
      item.status = "In Process";
      item.processingAt = now;
      item.processingByName = user.name;
      summary = `Started processing ${item.testName} on ${order.code}`;
      break;

    case "sendout": {
      need(["Sample Received", "In Process"], "send out");
      const labId = body.lab ?? item.outsourceLab;
      const lab = labId && isObjectId(String(labId)) ? await OutLabs().findById(labId).lean<Doc>() : null;
      if (!lab || lab.status !== "Active") fail({ lab: "Select an active outsourced lab" });
      item.outsourceLab = lab._id;
      item.outsourceLabName = String(lab.name);
      item.outsourceRef = text(body.reference, 60) || undefined;
      item.sentOutAt = now;
      item.status = "Sent Out";
      summary = `Sent ${item.testName} on ${order.code} to ${lab.name}${item.outsourceRef ? ` (ref ${item.outsourceRef})` : ""}`;
      break;
    }

    case "results": {
      need(RESULT_EDITABLE, "enter results");
      const errors: Record<string, string> = {};
      if (item.reportType === "Descriptive") {
        const report = text(body.reportText, 10000);
        if (report.length < 3) errors.reportText = "Write the report";
        item.reportText = report;
        item.abnormal = false;
        item.critical = false;
      } else {
        const rows = await templateRows(item, order.patientGender, order.patientAge);
        const input = new Map<string, unknown>();
        for (const r of Array.isArray(body.results) ? (body.results as Record<string, unknown>[]) : []) input.set(String(r.key), r.value);
        const saved = rows.map((row, idx) => {
          const key = row.parameter ? String(row.parameter) : row.name;
          const value = String(input.get(key) ?? "").trim();
          const at = `results.${idx}`;
          let n: number | undefined;
          if (!value) errors[at] = `Enter ${row.name}`;
          else if (value.length > 200) errors[at] = `${row.name} is too long`;
          else if (row.resultType === "Numeric") {
            n = Number(value);
            if (!Number.isFinite(n)) errors[at] = `${row.name} must be a number`;
          } else if (row.resultType === "Options" && row.options && !row.options.split(",").map((o) => o.trim().toLowerCase()).includes(value.toLowerCase())) {
            errors[at] = `${row.name} must be one of ${row.options}`;
          }
          const plainRow = "toObject" in row && typeof row.toObject === "function" ? row.toObject() : row;
          return { ...plainRow, value, numeric: n, flag: errors[at] ? "" : flagFor(row, value, n) };
        });
        item.set("results", saved);
        item.abnormal = saved.some((r) => r.flag);
        item.critical = saved.some((r) => r.flag === "LL" || r.flag === "HH");
      }
      if (Object.keys(errors).length) fail(errors);
      item.remarks = text(body.remarks, 1000) || undefined;
      if (item.status === "Sent Out") item.receivedBackAt = now;
      const corrected = item.status === "Verified" || item.status === "Result Entered";
      item.status = "Result Entered";
      item.enteredAt = now;
      item.enteredBy = new Types.ObjectId(user.id);
      item.enteredByName = user.name;
      item.verifiedAt = undefined;
      item.verifiedBy = undefined;
      item.verifiedByName = undefined;
      summary = `${corrected ? "Corrected" : "Entered"} results for ${item.testName} on ${order.code}${item.critical ? " — CRITICAL values" : item.abnormal ? " — abnormal values" : ""}`;
      break;
    }

    case "verify":
      need(["Result Entered"], "verify");
      item.status = "Verified";
      item.verifiedAt = now;
      item.verifiedBy = new Types.ObjectId(user.id);
      item.verifiedByName = user.name;
      summary = `Verified ${item.testName} on ${order.code}`;
      break;

    case "approve": {
      need(["Verified"], "approve");
      if (String(item.verifiedBy) === user.id) {
        throw new ApiError(403, `You verified this result, so a different user must approve it (four-eyes check).`);
      }
      const doc = isObjectId(body.pathologist) ? await Doctors().findById(body.pathologist).lean<Doc>() : null;
      if (!doc || doc.status === "Inactive") fail({ pathologist: "Select the approving pathologist" });
      item.status = "Approved";
      item.approvedAt = now;
      item.approvedBy = new Types.ObjectId(user.id);
      item.approvedByName = user.name;
      item.pathologist = doc._id;
      item.pathologistName = String(doc.fullName);
      item.pathologistQualification = (doc.qualification as string) ?? undefined;
      item.pathologistRegNo = (doc.registrationNo as string) ?? undefined;
      summary = `Approved ${item.testName} on ${order.code} (pathologist ${doc.fullName})`;
      break;
    }

    case "reopen": {
      need(["Verified", "Approved"], "reopen");
      const reason = text(body.reason, 300);
      if (reason.length < 3) fail({ reason: "Enter a reason for reopening" });
      const was = item.status;
      item.status = "Result Entered";
      for (const k of ["verifiedAt", "verifiedBy", "verifiedByName", "approvedAt", "approvedBy", "approvedByName", "pathologist", "pathologistName", "pathologistQualification", "pathologistRegNo"] as const) item.set(k, undefined);
      summary = `Reopened ${was.toLowerCase()} ${item.testName} on ${order.code} for correction. Reason: ${reason}`;
      break;
    }

    case "cancel": {
      if (item.status === "Cancelled") throw new ApiError(409, "Test is already cancelled");
      if (item.status === "Approved") throw new ApiError(409, "Reported tests cannot be cancelled. Reopen it first if the result is wrong.");
      const reason = text(body.reason, 300);
      if (reason.length < 3) fail({ reason: "Enter a reason for cancelling" });
      item.status = "Cancelled";
      item.cancelledAt = now;
      item.cancelReason = reason;
      item.cancelledByName = user.name;
      summary = `Cancelled ${item.testName} on ${order.code} (₹${item.price}). Reason: ${reason}`;
      break;
    }

    default:
      throw new ApiError(400, "Unknown action");
  }

  recompute(order);
  await save(order);
  await audit(req, user, order, summary);
  return getOrder(orderId);
}

export async function cancelOrder(id: string, reason: string, user: SessionUser, req: Request) {
  const order = await loadOrder(id);
  if (order.status === "Cancelled") throw new ApiError(409, "Order is already cancelled");
  if (reason.trim().length < 3) fail({ reason: "Enter a reason for cancelling" });
  if (order.items.some((i) => i.status === "Approved")) throw new ApiError(409, "Some tests are already reported. Cancel the remaining tests individually.");
  const now = new Date();
  for (const i of order.items) {
    if (i.status === "Cancelled") continue;
    i.status = "Cancelled";
    i.cancelledAt = now;
    i.cancelReason = reason.trim().slice(0, 300);
    i.cancelledByName = user.name;
  }
  order.cancelledAt = now;
  order.cancelReason = reason.trim().slice(0, 300);
  recompute(order);
  await save(order);
  await audit(req, user, order, `Cancelled lab order ${order.code}${order.paidAmount > 0 ? ` — refund of ₹${order.paidAmount} due` : ""}. Reason: ${reason.trim()}`);
  return getOrder(id);
}

/* ======================= billing ======================= */

export async function addPayment(id: string, body: Record<string, unknown>, user: SessionUser, req: Request) {
  const order = await loadOrder(id);
  const kind = body.kind === "Refund" ? "Refund" : "Payment";
  const amount = r2(num(body.amount));
  const mode = String(body.mode ?? "");
  if (!(PAYMENT_MODES as readonly string[]).includes(mode) || mode === "Credit") fail({ mode: "Select the payment mode" });
  if (kind === "Payment") {
    if (order.status === "Cancelled") throw new ApiError(409, "Cancelled orders cannot take payments");
    const balance = r2(order.netAmount - order.paidAmount);
    if (!(amount > 0 && amount <= balance)) fail({ amount: balance > 0 ? `Enter an amount between 1 and ${balance}` : "Nothing is due on this order" });
  } else {
    const due = r2(order.paidAmount - order.netAmount);
    if (!(amount > 0 && amount <= due)) fail({ amount: due > 0 ? `Refund must be between 1 and ${due}` : "No refund is due on this order" });
  }
  order.payments.push({ kind, amount, mode: mode as (typeof PAYMENT_MODES)[number], reference: text(body.reference, 60) || undefined, at: new Date(), byName: user.name });
  recompute(order);
  await save(order);
  await audit(req, user, order, `${kind === "Refund" ? "Refunded" : "Received"} ₹${amount} (${mode}) on lab order ${order.code}; balance ₹${r2(order.netAmount - order.paidAmount)}`);
  return getOrder(id);
}

/* ======================= report sharing ======================= */

export async function shareReport(id: string, body: Record<string, unknown>, user: SessionUser, req: Request) {
  const order = await loadOrder(id);
  if (!order.items.some((i) => i.status === "Approved")) throw new ApiError(409, "No approved results to share yet");
  const to = body.to === "Doctor" ? "Doctor" : "Patient";
  const channel = String(body.channel ?? "Link");
  if (!["Link", "WhatsApp", "Email", "SMS"].includes(channel)) fail({ channel: "Select how to share" });
  const recipient = text(body.recipient, 120);
  if ((channel === "WhatsApp" || channel === "SMS") && !PHONE_RE.test(recipient)) fail({ recipient: "Enter a valid mobile number" });
  if (channel === "Email" && !isValidEmail(recipient)) fail({ recipient: "Enter a valid email address" });

  if (!order.shareToken || !order.shareExpiresAt || order.shareExpiresAt < new Date()) {
    order.shareToken = randomBytes(24).toString("base64url");
    order.shareExpiresAt = new Date(Date.now() + SHARE_DAYS * 86400_000);
  }
  order.shares.push({ to, channel: channel as "Link", recipient: recipient || undefined, at: new Date(), byName: user.name });
  await save(order);
  await audit(req, user, order, `Shared report ${order.code} with ${to.toLowerCase()} via ${channel}${recipient ? ` (${recipient})` : ""}`);
  return { token: order.shareToken, expiresAt: order.shareExpiresAt.toISOString() };
}

export async function revokeShare(id: string, user: SessionUser, req: Request) {
  const order = await loadOrder(id);
  if (!order.shareToken) throw new ApiError(409, "There is no active share link");
  order.shareToken = undefined;
  order.shareExpiresAt = undefined;
  await save(order);
  await audit(req, user, order, `Revoked the shared report link for ${order.code}`);
  return { revoked: true };
}

/** Report view for a share link: approved results only, no billing data. */
export async function sharedReport(token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) throw new ApiError(404, "This report link is invalid or has expired");
  const order = await LabOrder.findOne({ shareToken: token, shareExpiresAt: { $gt: new Date() } }).select("-payments -shares -createdBy").lean();
  if (!order) throw new ApiError(404, "This report link is invalid or has expired");
  const o = plain(order) as Record<string, unknown> & { items: { status: string }[] };
  for (const k of ["shareToken", "patient", "visit", "admission", "doctor", "doctorPhone", "doctorEmail", "patientMobile", "grossAmount", "discount", "netAmount", "paidAmount", "paymentStatus", "ratePlan", "createdByName"]) delete o[k];
  return { ...o, items: o.items.filter((i) => i.status === "Approved"), shared: true, lab: labInfo() };
}

/* ======================= analytics ======================= */

export async function analytics(url: URL) {
  const today = todayUtc();
  const from = parseDay(url.searchParams.get("from")) ?? new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const to = parseDay(url.searchParams.get("to")) ?? today;
  if (from > to) throw new ApiError(422, "From date must be before To date");
  const range = { $gte: from, $lte: new Date(to.getTime() + 86400_000 - 1) };

  const orders = await LabOrder.find({ orderDate: range }).select("-items.results -shares").lean();
  const soon = new Date(today.getTime() + 30 * 86400_000);
  const [pending, qc, equipment, reagents] = await Promise.all([
    LabOrder.aggregate<{ _id: string; n: number }>([
      { $match: { status: { $nin: ["Cancelled", "Reported"] } } },
      { $unwind: "$items" },
      { $match: { "items.status": { $nin: ["Approved", "Cancelled"] } } },
      { $group: { _id: "$items.status", n: { $sum: 1 } } },
    ]),
    model("laboratory", "qc").find({ runDate: range }).sort({ runDate: -1 }).populate({ path: "equipment", select: "name" }).lean<Doc[]>(),
    model("laboratory", "equipment")
      .find({ status: { $ne: "Retired" }, $or: [{ nextCalibrationDue: { $lte: soon } }, { nextServiceDue: { $lte: soon } }, { status: { $in: ["Under Maintenance", "Out of Order"] } }] })
      .lean<Doc[]>(),
    model("laboratory", "reagents").find({ $or: [{ status: { $in: ["Low Stock", "Out of Stock", "Expired"] } }, { expiryDate: { $lte: soon } }] }).lean<Doc[]>(),
  ]);

  const live = orders.filter((o) => o.status !== "Cancelled");
  const items = orders.flatMap((o) => o.items.map((i) => ({ ...i, order: o })));
  const liveItems = items.filter((i) => i.status !== "Cancelled");
  const count = <T,>(arr: T[], key: (t: T) => string) => {
    const m = new Map<string, number>();
    for (const a of arr) m.set(key(a), (m.get(key(a)) ?? 0) + 1);
    return [...m.entries()].map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n);
  };
  const hours = (a?: Date | null, b?: Date | null) => (a && b ? (b.getTime() - a.getTime()) / 3600_000 : null);
  const approved = liveItems.filter((i) => i.status === "Approved" && i.approvedAt);
  const tats = approved.map((i) => hours(i.order.orderDate, i.approvedAt)!).sort((a, b) => a - b);

  const byCategory = new Map<string, { tests: number; revenue: number; tat: number[] }>();
  for (const i of liveItems) {
    const c = byCategory.get(i.categoryName ?? "Other") ?? { tests: 0, revenue: 0, tat: [] };
    c.tests++;
    c.revenue += i.price;
    if (i.status === "Approved" && i.approvedAt) c.tat.push(hours(i.order.orderDate, i.approvedAt)!);
    byCategory.set(i.categoryName ?? "Other", c);
  }
  const byTest = new Map<string, { name: string; tests: number; revenue: number }>();
  for (const i of liveItems) {
    const t = byTest.get(String(i.test)) ?? { name: i.testName, tests: 0, revenue: 0 };
    t.tests++;
    t.revenue += i.price;
    byTest.set(String(i.test), t);
  }
  const samples = orders.flatMap((o) => o.samples);
  const rejected = samples.filter((s) => s.status === "Rejected");
  const avg = (a: number[]) => (a.length ? r2(a.reduce((s, x) => s + x, 0) / a.length) : null);

  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    totals: {
      orders: live.length,
      cancelledOrders: orders.length - live.length,
      tests: liveItems.length,
      cancelledTests: items.length - liveItems.length,
      reportedTests: approved.length,
      billed: r2(live.reduce((s, o) => s + o.netAmount, 0)),
      discount: r2(live.reduce((s, o) => s + (o.discount ?? 0), 0)),
      collected: r2(orders.reduce((s, o) => s + o.paidAmount, 0)),
      outstanding: r2(live.reduce((s, o) => s + Math.max(0, o.netAmount - o.paidAmount), 0)),
      refundDue: r2(orders.reduce((s, o) => s + Math.max(0, o.paidAmount - o.netAmount), 0)),
      abnormal: liveItems.filter((i) => i.abnormal).length,
      critical: liveItems.filter((i) => i.critical).length,
      samples: samples.length,
      rejectedSamples: rejected.length,
      rejectionRate: samples.length ? r2((rejected.length / samples.length) * 100) : 0,
      avgTatHours: avg(tats),
      medianTatHours: tats.length ? r2(tats[Math.floor(tats.length / 2)]) : null,
      outsourced: liveItems.filter((i) => i.sentOutAt).length,
    },
    bySource: count(live, (o) => o.source),
    byStatus: count(orders, (o) => o.status),
    byCategory: [...byCategory.entries()].map(([label, c]) => ({ label, tests: c.tests, revenue: r2(c.revenue), avgTatHours: avg(c.tat) })).sort((a, b) => b.tests - a.tests),
    topTests: [...byTest.values()].map((t) => ({ ...t, revenue: r2(t.revenue) })).sort((a, b) => b.tests - a.tests).slice(0, 10),
    rejectionReasons: count(rejected, (s) => (s.rejectReason ?? "Other").split(":")[0]),
    outsourcedByLab: count(liveItems.filter((i) => i.sentOutAt), (i) => i.outsourceLabName ?? "—"),
    daily: count(live, (o) => o.orderDate.toISOString().slice(0, 10))
      .map((d) => ({ date: d.label, orders: d.n, billed: r2(live.filter((o) => o.orderDate.toISOString().startsWith(d.label)).reduce((s, o) => s + o.netAmount, 0)) }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    pending: pending.map((p) => ({ label: p._id, n: p.n })),
    qc: {
      runs: qc.length,
      pass: qc.filter((q) => q.result === "Pass").length,
      warning: qc.filter((q) => q.result === "Warning").length,
      fail: qc.filter((q) => q.result === "Fail").length,
      recentFailures: qc.filter((q) => q.result !== "Pass").slice(0, 8).map((q) => ({
        id: String(q._id), code: q.code, runDate: (q.runDate as Date).toISOString(), analyte: q.analyte, level: q.controlLevel,
        equipment: ((q.equipment as Doc | null)?.name as string) ?? "—", zScore: q.zScore, result: q.result, rule: q.ruleViolated,
      })),
    },
    equipmentDue: equipment.map((e) => ({
      id: String(e._id), name: e.name, status: e.status,
      nextCalibrationDue: (e.nextCalibrationDue as Date | undefined)?.toISOString() ?? null, nextServiceDue: (e.nextServiceDue as Date | undefined)?.toISOString() ?? null,
    })),
    reagentAlerts: reagents.map((r) => ({ id: String(r._id), name: r.name, lotNo: r.lotNo ?? null, quantity: r.quantity ?? 0, unit: r.unit, status: r.status, expiryDate: (r.expiryDate as Date | undefined)?.toISOString() ?? null })),
    register: items.slice(0, 5000).map((i) => ({
      labNo: i.order.code, date: i.order.orderDate.toISOString(), patient: i.order.patientName, patientCode: i.order.patientCode, source: i.order.source,
      test: i.testName, category: i.categoryName ?? "", status: i.status, price: i.status === "Cancelled" ? 0 : i.price,
      approvedAt: i.approvedAt?.toISOString() ?? null, tatHours: i.status === "Approved" ? r2(hours(i.order.orderDate, i.approvedAt) ?? 0) : null,
      flag: i.critical ? "Critical" : i.abnormal ? "Abnormal" : "", outsourcedTo: i.sentOutAt ? (i.outsourceLabName ?? "") : "",
    })),
  };
}
