import "server-only";
import mongoose, { Types } from "mongoose";
import { ApiError, escapeRegex, pagination, parsePaging } from "./api";
import { logActivity } from "./audit";
import { billAction, updateBill } from "./billing";
import { r2 } from "./billing-math";
import { OPEN_CLAIM_STATUSES, claimOutstanding, documentChecklist, raiseClaimForBill } from "./insurance-claims";
import type { SessionUser } from "./session";
import { isObjectId } from "./validation";
import { Bill } from "@/models/billing";
import { nextCode } from "@/models/Counter";
import { CLAIM_STATUSES, CLAIM_TYPES, Claim, PREAUTH_STATUSES, PreAuth, ROOM_CATEGORIES, TREATMENT_TYPES, type ClaimDoc, type PreAuthDoc } from "@/models/insurance";
import { getRecordModel } from "@/models/records";

type Doc = Record<string, unknown> & { _id: Types.ObjectId };
type PDoc = mongoose.HydratedDocument<PreAuthDoc>;
type CDoc = mongoose.HydratedDocument<ClaimDoc>;

const model = (m: string, r: string) => getRecordModel(m, r)!;
const Policies = () => model("insurance", "policies");
const Providers = () => model("insurance", "providers");
const Patients = () => model("patients", "patients");
const Admissions = () => model("opd_ipd", "admissions");
const Doctors = () => model("doctors", "doctors");

const DAY = 86_400_000;
const SETTLE_MODES = ["Bank Transfer", "Cheque"] as const;
/** Pre-auths that still hold (or may get) an approval. */
const LIVE_PREAUTH: PreAuthDoc["status"][] = ["Draft", "Submitted", "Query Raised", "Approved", "Enhancement Requested"];

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

function text(v: unknown, max: number) {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function fail(errors: Record<string, string>, message = "Please correct the highlighted fields"): never {
  throw new ApiError(422, message, errors);
}

function ageYears(dob: unknown) {
  if (!(dob instanceof Date)) return undefined;
  const now = new Date();
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const m = now.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < dob.getUTCDate())) age--;
  return Math.max(0, age);
}

const money = (n: number) => `₹${r2(n).toLocaleString("en-IN")}`;
const sameId = (a: unknown, b: unknown) => !!a && !!b && String(a) === String(b);
const iso = (d: unknown) => (d instanceof Date ? d.toISOString() : null);

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

async function saveDoc(doc: PDoc | CDoc, what: string) {
  try {
    await doc.save();
  } catch (err) {
    if (err instanceof mongoose.Error.VersionError) throw new ApiError(409, `This ${what} was just updated by someone else. Refresh and try again.`);
    throw err;
  }
}

function audit(req: Request, user: SessionUser, resource: "preauths" | "claims", doc: { _id: unknown; code: string }, summary: string, action: "create" | "update" = "update") {
  return logActivity({ req, user, action, module: "insurance", resource, entityId: String(doc._id), entityLabel: doc.code, summary });
}

/** Sum insured still available on a policy: approvals and claims already made against it are used up. */
async function coverUsed(policy: Doc, exceptPreauth?: unknown) {
  const [pre, claims] = await Promise.all([
    PreAuth.aggregate<{ s: number }>([
      { $match: { policy: policy._id, status: { $in: ["Approved", "Enhancement Requested", "Claimed"] }, ...(exceptPreauth ? { _id: { $ne: exceptPreauth } } : {}) } },
      { $group: { _id: null, s: { $sum: "$approvedAmount" } } },
    ]),
    // Claims without a pre-auth (reimbursements) also use the cover.
    Claim.aggregate<{ s: number }>([
      { $match: { policy: policy._id, preauth: null, status: { $nin: ["Rejected", "Cancelled"] } } },
      { $group: { _id: null, s: { $sum: "$claimAmount" } } },
    ]),
  ]);
  const used = r2((pre[0]?.s ?? 0) + (claims[0]?.s ?? 0));
  const sum = Number(policy.sumInsured ?? 0);
  return { used, available: r2(Math.max(0, sum - used)) };
}

/** Policy must be the patient's, active on `on`, with an empanelled insurer. */
async function checkPolicy(policyId: unknown, patientId: Types.ObjectId, on: Date) {
  if (!isObjectId(policyId)) fail({ policy: "Select the patient's insurance policy" });
  const policy = await Policies().findById(policyId).lean<Doc>();
  if (!policy || !sameId(policy.patient, patientId)) fail({ policy: "Select a policy of this patient" });
  if (policy.status === "Suspended") fail({ policy: "This policy is suspended" });
  if (policy.validTo instanceof Date && policy.validTo < on) fail({ policy: `Policy expired on ${policy.validTo.toISOString().slice(0, 10)}` });
  if (policy.validFrom instanceof Date && policy.validFrom > on) fail({ policy: `Policy starts on ${policy.validFrom.toISOString().slice(0, 10)}` });
  const [insurer, tpa] = await Promise.all([
    Providers().findById(policy.insurer).lean<Doc>(),
    policy.tpa ? Providers().findById(policy.tpa).lean<Doc>() : Promise.resolve(null),
  ]);
  if (!insurer) fail({ policy: "The policy's insurer no longer exists" });
  if (insurer.status === "Inactive") fail({ policy: `${insurer.name} is inactive` });
  if (insurer.agreementValidUntil instanceof Date && insurer.agreementValidUntil < todayUtc()) fail({ policy: `Empanelment with ${insurer.name} expired on ${insurer.agreementValidUntil.toISOString().slice(0, 10)}` });
  return { policy, insurer, tpa };
}

/* ======================= patient cover ======================= */

/** Everything the pre-auth and claim forms need about a patient. */
export async function patientCover(patientId: string) {
  if (!isObjectId(patientId)) throw new ApiError(404, "Patient not found");
  const p = await Patients().findById(patientId).select("fullName code gender dateOfBirth mobile").lean<Doc>();
  if (!p) throw new ApiError(404, "Patient not found");
  const [policies, admissions, bills, preauths] = await Promise.all([
    Policies().find({ patient: p._id }).sort({ validTo: -1 }).populate([{ path: "insurer", select: "name" }, { path: "tpa", select: "name" }]).lean<Doc[]>(),
    Admissions().find({ patient: p._id, status: "Admitted" }).sort({ admissionDate: -1 }).populate({ path: "doctor", select: "fullName code specialization" }).lean<Doc[]>(),
    Bill.find({ patient: p._id, payerType: "Insurance", status: { $in: ["Final", "Closed"] } }).sort({ billDate: -1 }).limit(10).select("code billDate payerName payerShare claim claimCode admissionCode policyNo").lean(),
    PreAuth.find({ patient: p._id, status: { $in: LIVE_PREAUTH } }).select("code status admissionCode approvedAmount").lean(),
  ]);
  const today = todayUtc();
  return {
    patient: { id: String(p._id), name: String(p.fullName), code: (p.code as string) ?? "", gender: (p.gender as string) ?? "", age: ageYears(p.dateOfBirth) ?? null, mobile: (p.mobile as string) ?? "" },
    policies: await Promise.all(
      policies.map(async (x) => ({
        id: String(x._id), policyNumber: String(x.policyNumber), memberId: (x.memberId as string) ?? null, policyType: (x.policyType as string) ?? null,
        insurer: (x.insurer as Doc | null)?.name ?? "—", tpa: (x.tpa as Doc | null)?.name ?? null, sumInsured: Number(x.sumInsured ?? 0), copayPct: (x.copayPct as number) ?? null,
        roomRentLimit: (x.roomRentLimit as number) ?? null, validFrom: iso(x.validFrom), validTo: iso(x.validTo), status: String(x.status ?? "Active"),
        usable: x.status !== "Suspended" && !(x.validTo instanceof Date && x.validTo < today), cover: await coverUsed(x),
      }))
    ),
    admissions: admissions.map((a) => ({
      id: String(a._id), code: String(a.code), date: iso(a.admissionDate), ward: a.ward, bed: a.bedNumber, diagnosis: (a.diagnosis as string) ?? null,
      doctor: a.doctor && typeof a.doctor === "object" ? { id: String((a.doctor as Doc)._id), label: String((a.doctor as Doc).fullName), code: (a.doctor as Doc).code as string, department: (a.doctor as Doc).specialization as string } : null,
    })),
    bills: bills.map((b) => ({ id: String(b._id), code: b.code, date: b.billDate.toISOString(), payerName: b.payerName ?? null, payerShare: b.payerShare, claimCode: b.claimCode ?? null, admissionCode: b.admissionCode ?? null, policyNo: b.policyNo ?? null })),
    openPreauths: preauths.map((x) => ({ id: String(x._id), code: x.code, status: x.status, admissionCode: x.admissionCode ?? null, approvedAmount: x.approvedAmount ?? 0 })),
  };
}

/* ======================= pre-authorisation ======================= */

function preauthRow(d: Record<string, unknown>) {
  return {
    id: String(d._id), code: d.code, createdAt: iso(d.createdAt), patientName: d.patientName, patientCode: d.patientCode ?? null, insurerName: d.insurerName ?? null, tpaName: d.tpaName ?? null,
    policyNumber: d.policyNumber ?? null, admissionCode: d.admissionCode ?? null, diagnosis: d.diagnosis, treatmentType: d.treatmentType ?? null, requestedAmount: d.requestedAmount ?? 0,
    approvedAmount: d.approvedAmount ?? 0, authNo: d.authNo ?? null, status: d.status, submittedAt: iso(d.submittedAt), billCode: d.billCode ?? null, claimCode: d.claimCode ?? null,
    openQuery: ((d.queries as { response?: string }[]) ?? []).some((q) => !q.response),
  };
}

export async function listPreauths(url: URL) {
  const { page, limit, skip } = parsePaging(url, 15);
  const filter: Record<string, unknown> = {};
  const q = text(url.searchParams.get("search"), 60);
  if (q) {
    const rx = new RegExp(escapeRegex(q), "i");
    filter.$or = [{ code: rx }, { patientName: rx }, { patientCode: rx }, { policyNumber: rx }, { authNo: rx }, { insurerName: rx }, { tpaName: rx }, { admissionCode: rx }, { diagnosis: rx }];
  }
  const status = url.searchParams.get("status");
  if (status === "Open") filter.status = { $in: ["Draft", "Submitted", "Query Raised", "Enhancement Requested"] };
  else if (status && (PREAUTH_STATUSES as readonly string[]).includes(status)) filter.status = status;
  const insurer = url.searchParams.get("insurer");
  if (isObjectId(insurer)) filter.$and = [{ $or: [{ insurer: new Types.ObjectId(insurer) }, { tpa: new Types.ObjectId(insurer) }] }];
  const [docs, total] = await Promise.all([PreAuth.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(), PreAuth.countDocuments(filter)]);
  return { items: docs.map((d) => preauthRow(d as unknown as Record<string, unknown>)), pagination: pagination(page, limit, total) };
}

async function loadPreauth(id: string) {
  if (!isObjectId(id)) throw new ApiError(404, "Pre-authorisation not found");
  const doc = await PreAuth.findById(id);
  if (!doc) throw new ApiError(404, "Pre-authorisation not found");
  return doc as unknown as PDoc;
}

export async function getPreauth(id: string) {
  const pre = await loadPreauth(id);
  const policy = await Policies().findById(pre.policy).lean<Doc>();
  const bill = pre.admission ? await Bill.findOne({ admission: pre.admission, status: { $ne: "Cancelled" } }).sort({ createdAt: -1 }).select("code status payerType payerName payerLimit authNo netAmount payerShare").lean() : null;
  return {
    ...(plain(pre.toObject()) as Record<string, unknown>),
    cover: policy ? { sumInsured: Number(policy.sumInsured ?? 0), ...(await coverUsed(policy, pre._id)), validTo: iso(policy.validTo), roomRentLimit: (policy.roomRentLimit as number) ?? null, copayPct: (policy.copayPct as number) ?? null } : null,
    currentBill: bill ? { id: String(bill._id), code: bill.code, status: bill.status, payerType: bill.payerType, payerName: bill.payerName ?? null, payerLimit: bill.payerLimit ?? null, authNo: bill.authNo ?? null, netAmount: bill.netAmount, payerShare: bill.payerShare } : null,
  };
}

/** Admission of this patient that is currently admitted. */
async function checkAdmission(admissionId: unknown, patientId: Types.ObjectId, exceptPreauth?: unknown) {
  if (!isObjectId(admissionId)) fail({ admission: "Select the admission" });
  const a = await Admissions().findById(admissionId).lean<Doc>();
  if (!a || !sameId(a.patient, patientId)) fail({ admission: "Select an admission of this patient" });
  if (a.status !== "Admitted") fail({ admission: `Admission ${a.code} is ${String(a.status).toLowerCase()}` });
  const other = await PreAuth.findOne({ admission: a._id, status: { $in: LIVE_PREAUTH }, ...(exceptPreauth ? { _id: { $ne: exceptPreauth } } : {}) }).select("code").lean();
  if (other) fail({ admission: `Admission ${a.code} already has pre-auth ${other.code}. Request an enhancement on it instead.` });
  return a;
}

function clinicalFields(body: Record<string, unknown>, errors: Record<string, string>) {
  const diagnosis = text(body.diagnosis, 300);
  if (diagnosis.length < 3) errors.diagnosis = "Enter the provisional diagnosis";
  const treatmentType = String(body.treatmentType ?? "");
  if (!(TREATMENT_TYPES as readonly string[]).includes(treatmentType)) errors.treatmentType = "Select the line of treatment";
  const roomCategory = body.roomCategory ? String(body.roomCategory) : "";
  if (roomCategory && !(ROOM_CATEGORIES as readonly string[]).includes(roomCategory)) errors.roomCategory = "Select the room category";
  const stay = body.expectedStayDays === "" || body.expectedStayDays === undefined || body.expectedStayDays === null ? undefined : Math.round(num(body.expectedStayDays));
  if (stay !== undefined && !(stay >= 0 && stay <= 365)) errors.expectedStayDays = "Enter the expected stay in days";
  const estimatedAmount = r2(num(body.estimatedAmount));
  if (!(estimatedAmount > 0)) errors.estimatedAmount = "Enter the estimated cost";
  const requestedAmount = body.requestedAmount === "" || body.requestedAmount === undefined || body.requestedAmount === null ? estimatedAmount : r2(num(body.requestedAmount));
  if (!(requestedAmount > 0)) errors.requestedAmount = "Enter the amount requested";
  else if (requestedAmount > estimatedAmount) errors.requestedAmount = "Cannot exceed the estimate";
  return {
    diagnosis, icdCode: text(body.icdCode, 20).toUpperCase() || undefined, treatmentType, procedure: text(body.procedure, 200) || undefined, expectedStayDays: stay,
    roomCategory: roomCategory || undefined, estimatedAmount, requestedAmount, notes: text(body.notes, 500) || undefined,
  };
}

export async function createPreauth(body: Record<string, unknown>, user: SessionUser, req: Request) {
  const errors: Record<string, string> = {};
  const patient = isObjectId(body.patient) ? await Patients().findById(body.patient).lean<Doc>() : null;
  if (!patient) fail({ patient: "Select the patient" });
  const planned = body.plannedAdmissionDate ? parseDay(body.plannedAdmissionDate) : null;
  if (body.plannedAdmissionDate && !planned) errors.plannedAdmissionDate = "Enter a valid date";
  const admission = body.admission ? await checkAdmission(body.admission, patient._id) : null;
  if (!admission && !planned) errors.admission = "Select the current admission, or enter the planned admission date";
  const clinical = clinicalFields(body, errors);
  if (Object.keys(errors).length) fail(errors);
  const { policy, insurer, tpa } = await checkPolicy(body.policy, patient._id, (admission?.admissionDate as Date | undefined) ?? planned ?? todayUtc());

  let doctor: Doc | null = null;
  const doctorId = body.doctor || admission?.doctor;
  if (doctorId) {
    doctor = isObjectId(String(doctorId)) ? await Doctors().findById(doctorId).lean<Doc>() : null;
    if (!doctor) fail({ doctor: "Doctor not found" });
  }
  const now = new Date();
  const submit = body.submit === true;
  const pre = new PreAuth({
    code: await nextCode("PA"),
    patient: patient._id, patientName: patient.fullName, patientCode: patient.code, patientAge: ageYears(patient.dateOfBirth), patientGender: patient.gender, patientMobile: patient.mobile,
    policy: policy._id, insurer: insurer._id, insurerName: insurer.name, tpa: tpa?._id, tpaName: tpa?.name, policyNumber: policy.policyNumber, memberId: policy.memberId, sumInsured: policy.sumInsured, copayPct: policy.copayPct,
    admission: admission?._id, admissionCode: admission?.code, admissionDate: admission?.admissionDate, plannedAdmissionDate: planned ?? undefined,
    doctor: doctor?._id, doctorName: doctor?.fullName, department: text(body.department, 60) || (doctor?.specialization as string | undefined),
    ...clinical,
    status: submit ? "Submitted" : "Draft", submittedAt: submit ? now : undefined,
    events: [{ at: now, action: submit ? "Submitted" : "Drafted", byName: user.name, note: `${money(clinical.requestedAmount)} requested from ${tpa?.name ?? insurer.name}` }],
    createdBy: user.id, createdByName: user.name,
  }) as unknown as PDoc;
  await saveDoc(pre, "pre-authorisation");
  await audit(req, user, "preauths", pre, `${submit ? "Submitted" : "Drafted"} pre-auth ${pre.code} for ${pre.patientName}: ${pre.diagnosis}, ${money(pre.requestedAmount)} from ${pre.tpaName ?? pre.insurerName}`, "create");
  return getPreauth(String(pre._id));
}

/**
 * Put the approval on the admission's IPD bill: switch it to insurance with the
 * sanctioned amount as the payer limit. Never fails the approval itself.
 */
async function syncBill(pre: PDoc, user: SessionUser, req: Request): Promise<string | null> {
  if (!["Approved", "Enhancement Requested"].includes(pre.status) || !(pre.approvedAmount > 0)) return null;
  if (!pre.admission) return "link the admission to apply the approval to the IPD bill";
  const bill = await Bill.findOne({ admission: pre.admission, status: { $in: ["Provisional", "Final"] } }).sort({ createdAt: -1 }).lean();
  if (!bill) return "the approval will be applied when the IPD bill is opened";
  const payer = { authNo: pre.authNo ?? "", policyNo: pre.policyNumber ?? "", tpaName: pre.tpaName ?? "", payerLimit: pre.approvedAmount };
  try {
    if (bill.status === "Provisional") {
      await updateBill(String(bill._id), { payerType: "Insurance", insuranceProvider: String(pre.insurer), ...payer }, user, req);
    } else if (bill.payerType === "Insurance" && sameId(bill.insuranceProvider, pre.insurer)) {
      await updateBill(String(bill._id), payer, user, req);
    } else {
      return `bill ${bill.code} is already final as ${bill.payerType === "Self" ? "self-pay" : bill.payerName}; reopen it in Billing to switch it to insurance`;
    }
  } catch (err) {
    if (err instanceof ApiError) return `bill ${bill.code} not updated: ${err.message}`;
    throw err;
  }
  pre.bill = bill._id;
  pre.billCode = bill.code;
  pre.billSyncedAt = new Date();
  return `bill ${bill.code} set to ${pre.tpaName ?? pre.insurerName} with approved limit ${money(pre.approvedAmount)}`;
}

/**
 * Actions: submit | update | query | respond | approve | reject | enhance | decide-enhancement
 * | link-admission | sync-bill | cancel
 */
export async function preauthAction(id: string, body: Record<string, unknown>, user: SessionUser, req: Request) {
  const pre = await loadPreauth(id);
  const action = String(body.action ?? "");
  const now = new Date();
  const need = (...states: string[]) => {
    if (!states.includes(pre.status)) throw new ApiError(409, `Pre-auth is ${pre.status.toLowerCase()}`);
  };
  const log = (act: string, note?: string) => pre.events.push({ at: now, action: act, byName: user.name, note });
  let summary = "";
  let sync = false;

  switch (action) {
    case "update": {
      need("Draft");
      const errors: Record<string, string> = {};
      const clinical = clinicalFields({ ...pre.toObject(), ...body }, errors);
      if ("plannedAdmissionDate" in body) {
        const d = body.plannedAdmissionDate ? parseDay(body.plannedAdmissionDate) : null;
        if (body.plannedAdmissionDate && !d) errors.plannedAdmissionDate = "Enter a valid date";
        pre.plannedAdmissionDate = d ?? undefined;
      }
      if (Object.keys(errors).length) fail(errors);
      pre.set(clinical);
      log("Edited");
      summary = `Edited draft pre-auth ${pre.code}`;
      break;
    }
    case "submit":
      need("Draft");
      pre.status = "Submitted";
      pre.submittedAt = now;
      log("Submitted", text(body.note, 200) || undefined);
      summary = `Submitted pre-auth ${pre.code} to ${pre.tpaName ?? pre.insurerName} for ${money(pre.requestedAmount)}`;
      break;
    case "query": {
      need("Submitted", "Enhancement Requested");
      const query = text(body.query, 1000);
      if (query.length < 3) fail({ query: "Enter the insurer's query" });
      pre.queries.push({ raisedAt: parseDay(body.raisedOn) ?? now, query, raisedByName: user.name });
      pre.status = "Query Raised";
      log("Query raised", query);
      summary = `Insurer query on pre-auth ${pre.code}: ${query}`;
      break;
    }
    case "respond": {
      need("Query Raised");
      const response = text(body.response, 1000);
      if (response.length < 3) fail({ response: "Enter the reply sent to the insurer" });
      const open = [...pre.queries].reverse().find((q) => !q.response);
      if (!open) throw new ApiError(409, "No open query");
      Object.assign(open, { response, respondedAt: now, respondedByName: user.name });
      pre.status = pre.enhancements.some((e) => e.status === "Pending") ? "Enhancement Requested" : pre.approvedAmount > 0 ? "Approved" : "Submitted";
      log("Query answered", response);
      summary = `Answered the query on pre-auth ${pre.code}`;
      break;
    }
    case "approve": {
      need("Submitted", "Query Raised");
      const amount = r2(num(body.approvedAmount));
      const authNo = text(body.authNo, 60);
      if (!authNo) fail({ authNo: "Enter the authorisation / approval number" });
      if (!(amount > 0)) fail({ approvedAmount: "Enter the approved amount" });
      if (amount > pre.requestedAmount) fail({ approvedAmount: `Cannot exceed the ${money(pre.requestedAmount)} requested` });
      Object.assign(pre, { status: "Approved", authNo, approvedAmount: amount, approvedAt: now, decisionAt: now });
      log("Approved", `${authNo} · ${money(amount)}${amount < pre.requestedAmount ? ` of ${money(pre.requestedAmount)}` : ""}${text(body.remarks, 200) ? ` · ${text(body.remarks, 200)}` : ""}`);
      summary = `Pre-auth ${pre.code} approved by ${pre.tpaName ?? pre.insurerName}: ${authNo}, ${money(amount)}`;
      sync = true;
      break;
    }
    case "reject": {
      need("Submitted", "Query Raised");
      const reason = text(body.reason, 500);
      if (reason.length < 3) fail({ reason: "Enter the insurer's reason" });
      Object.assign(pre, { status: "Rejected", rejectReason: reason, decisionAt: now });
      log("Rejected", reason);
      summary = `Pre-auth ${pre.code} rejected by ${pre.tpaName ?? pre.insurerName}: ${reason}. The patient pays directly unless it is reconsidered.`;
      break;
    }
    case "enhance": {
      need("Approved");
      const amount = r2(num(body.amount));
      const reason = text(body.reason, 500);
      if (!(amount > 0)) fail({ amount: "Enter the additional amount needed" });
      if (reason.length < 3) fail({ reason: "Explain why more is needed (e.g. extended stay, change of procedure)" });
      pre.enhancements.push({ requestedAmount: amount, reason, requestedAt: now, requestedByName: user.name, status: "Pending" });
      pre.status = "Enhancement Requested";
      log("Enhancement requested", `${money(amount)} · ${reason}`);
      summary = `Requested enhancement of ${money(amount)} on pre-auth ${pre.code}: ${reason}`;
      break;
    }
    case "decide-enhancement": {
      need("Enhancement Requested");
      const e = pre.enhancements.find((x) => x.status === "Pending");
      if (!e) throw new ApiError(409, "No pending enhancement");
      const decision = String(body.decision);
      if (decision === "Approved") {
        const amount = r2(num(body.approvedAmount));
        if (!(amount > 0)) fail({ approvedAmount: "Enter the amount approved" });
        if (amount > e.requestedAmount) fail({ approvedAmount: `Cannot exceed the ${money(e.requestedAmount)} requested` });
        Object.assign(e, { status: "Approved", approvedAmount: amount, decidedAt: now, decidedByName: user.name, remarks: text(body.remarks, 200) || undefined });
        pre.approvedAmount = r2(pre.approvedAmount + amount);
        if (text(body.authNo, 60)) pre.authNo = text(body.authNo, 60);
        summary = `Enhancement of ${money(amount)} approved on pre-auth ${pre.code}; total approved ${money(pre.approvedAmount)}`;
        sync = true;
      } else if (decision === "Rejected") {
        const remarks = text(body.remarks, 200);
        if (remarks.length < 3) fail({ remarks: "Enter the insurer's reason" });
        Object.assign(e, { status: "Rejected", decidedAt: now, decidedByName: user.name, remarks });
        summary = `Enhancement of ${money(e.requestedAmount)} rejected on pre-auth ${pre.code}: ${remarks}`;
      } else fail({ decision: "Choose approve or reject" });
      pre.status = "Approved";
      log(`Enhancement ${decision.toLowerCase()}`, summary);
      break;
    }
    case "link-admission": {
      need("Draft", "Submitted", "Query Raised", "Approved", "Enhancement Requested");
      if (pre.admission) throw new ApiError(409, `Already linked to ${pre.admissionCode}`);
      const a = await checkAdmission(body.admission, pre.patient, pre._id);
      Object.assign(pre, { admission: a._id, admissionCode: a.code, admissionDate: a.admissionDate });
      log("Admission linked", String(a.code));
      summary = `Linked pre-auth ${pre.code} to admission ${a.code}`;
      sync = true;
      break;
    }
    case "sync-bill":
      need("Approved", "Enhancement Requested");
      summary = `Applied pre-auth ${pre.code} to the IPD bill`;
      sync = true;
      break;
    case "cancel": {
      need("Draft", "Submitted", "Query Raised", "Approved", "Enhancement Requested");
      const reason = text(body.reason, 300);
      if (reason.length < 3) fail({ reason: "Enter the reason for cancelling" });
      pre.status = "Cancelled";
      pre.cancelReason = reason;
      log("Cancelled", reason);
      summary = `Cancelled pre-auth ${pre.code}. Reason: ${reason}`;
      // A provisional bill that was switched to insurance by this approval goes back to self-pay.
      if (pre.bill) {
        const bill = await Bill.findById(pre.bill).select("code status payerType authNo").lean();
        if (bill?.status === "Provisional" && bill.payerType === "Insurance" && bill.authNo === pre.authNo) {
          try {
            await updateBill(String(bill._id), { payerType: "Self" }, user, req);
            summary += `; bill ${bill.code} switched back to self-pay`;
          } catch (err) {
            if (!(err instanceof ApiError)) throw err;
            summary += `; bill ${bill.code} not changed: ${err.message}`;
          }
        }
      }
      break;
    }
    default:
      throw new ApiError(400, "Unknown action");
  }

  if (sync) {
    const note = await syncBill(pre, user, req);
    if (note) {
      summary += `; ${note}`;
      log("Billing", note);
    }
  }
  await saveDoc(pre, "pre-authorisation");
  await audit(req, user, "preauths", pre, summary);
  return getPreauth(id);
}

/* ======================= claims ======================= */

function claimRow(d: Record<string, unknown>, today = todayUtc()) {
  const outstanding = Number(d.outstanding ?? d.claimAmount ?? 0);
  const open = !["Settled", "Rejected", "Cancelled"].includes(String(d.status));
  return {
    id: String(d._id), code: d.code, claimType: d.claimType ?? "Cashless", patientName: d.patientName ?? null, patientCode: d.patientCode ?? null, providerName: d.providerName ?? null, tpaName: d.tpaName ?? null,
    policyNumber: d.policyNumber, billCode: d.billCode ?? null, claimAmount: d.claimAmount, approvedAmount: d.approvedAmount ?? null, settledAmount: d.settledAmount ?? 0,
    deductionAmount: r2(Number(d.deductionAmount ?? 0) + Number(d.tdsAmount ?? 0)), outstanding, status: d.status, submittedDate: iso(d.submittedDate), dueDate: iso(d.dueDate), createdAt: iso(d.createdAt),
    overdue: open && !!d.submittedDate && d.dueDate instanceof Date && d.dueDate < today && outstanding > 0,
    ageDays: d.submittedDate instanceof Date ? Math.floor((today.getTime() - d.submittedDate.getTime()) / DAY) : null,
    missingDocs: ((d.documents as { required?: boolean; received?: boolean }[]) ?? []).filter((x) => x.required && !x.received).length,
  };
}

export async function listClaims(url: URL) {
  const { page, limit, skip } = parsePaging(url, 15);
  const filter: Record<string, unknown> = {};
  const q = text(url.searchParams.get("search"), 60);
  if (q) {
    const rx = new RegExp(escapeRegex(q), "i");
    filter.$or = [{ code: rx }, { patientName: rx }, { patientCode: rx }, { policyNumber: rx }, { billCode: rx }, { providerName: rx }, { tpaName: rx }, { authNo: rx }, { preauthCode: rx }];
  }
  const status = url.searchParams.get("status");
  if (status === "Outstanding") filter.status = { $in: ["Submitted", "Under Review", "Query Raised", "Approved", "Partially Settled"] };
  else if (status === "Overdue") Object.assign(filter, { status: { $in: ["Submitted", "Under Review", "Query Raised", "Approved", "Partially Settled"] }, dueDate: { $lt: todayUtc() } });
  else if (status && (CLAIM_STATUSES as readonly string[]).includes(status)) filter.status = status;
  const provider = url.searchParams.get("provider");
  if (isObjectId(provider)) filter.$and = [{ $or: [{ provider: new Types.ObjectId(provider) }, { tpa: new Types.ObjectId(provider) }] }];
  const [docs, total] = await Promise.all([Claim.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(), Claim.countDocuments(filter)]);
  return { items: docs.map((d) => claimRow(d as unknown as Record<string, unknown>)), pagination: pagination(page, limit, total) };
}

async function loadClaim(id: string) {
  if (!isObjectId(id)) throw new ApiError(404, "Claim not found");
  const doc = await Claim.findById(id);
  if (!doc) throw new ApiError(404, "Claim not found");
  return doc as unknown as CDoc;
}

export async function getClaim(id: string) {
  const claim = await loadClaim(id);
  // Claims recorded before the workflow have no checklist yet.
  if (!claim.documents.length && !["Settled", "Rejected", "Cancelled"].includes(claim.status)) claim.set("documents", documentChecklist(!!claim.preauth));
  const bill = claim.bill ? await Bill.findById(claim.bill).select("code status netAmount payerShare payerPaid payerDue payerWriteOff patientDue receipts.code receipts.kind receipts.amount receipts.at").lean() : null;
  return {
    ...(plain(claim.toObject()) as Record<string, unknown>),
    outstanding: claimOutstanding(claim),
    bill: bill ? { id: String(bill._id), code: bill.code, status: bill.status, netAmount: bill.netAmount, payerShare: bill.payerShare, payerPaid: bill.payerPaid, payerDue: bill.payerDue, payerWriteOff: bill.payerWriteOff, patientDue: bill.patientDue } : null,
  };
}

/** { bill } for an insurance bill without a claim, or { patient, policy, claimType, claimAmount, … } for a reimbursement claim. */
export async function createClaim(body: Record<string, unknown>, user: SessionUser, req: Request) {
  if (body.bill) {
    if (!isObjectId(body.bill)) fail({ bill: "Select the bill" });
    const bill = await Bill.findById(body.bill).lean();
    if (!bill) fail({ bill: "Bill not found" });
    if (bill.payerType !== "Insurance") fail({ bill: `${bill.code} is not an insurance bill` });
    if (bill.status !== "Final" && bill.status !== "Closed") fail({ bill: `Finalise ${bill.code} in Billing first` });
    const existing = await Claim.findOne({ bill: bill._id, status: { $ne: "Cancelled" } }).select("code").lean();
    if (existing) fail({ bill: `${bill.code} already has claim ${existing.code}` });
    const note = await raiseClaimForBill({ ...bill, claim: null } as Parameters<typeof raiseClaimForBill>[0], user);
    if (!note) fail({ bill: "Nothing is due from the insurer on this bill" });
    const claim = await Claim.findOne({ bill: bill._id, status: { $ne: "Cancelled" } }).sort({ createdAt: -1 }).lean();
    await audit(req, user, "claims", claim!, `Raised claim ${claim!.code} from bill ${bill.code}: ${note}`, "create");
    return getClaim(String(claim!._id));
  }

  const errors: Record<string, string> = {};
  const patient = isObjectId(body.patient) ? await Patients().findById(body.patient).lean<Doc>() : null;
  if (!patient) fail({ patient: "Select the patient" });
  const claimType = String(body.claimType ?? "Reimbursement");
  if (!(CLAIM_TYPES as readonly string[]).includes(claimType)) errors.claimType = "Select the claim type";
  const claimAmount = r2(num(body.claimAmount));
  if (!(claimAmount > 0)) errors.claimAmount = "Enter the amount claimed";
  const admissionDate = body.admissionDate ? parseDay(body.admissionDate) : null;
  const dischargeDate = body.dischargeDate ? parseDay(body.dischargeDate) : null;
  if (admissionDate && dischargeDate && dischargeDate < admissionDate) errors.dischargeDate = "Cannot be before the admission date";
  const diagnosis = text(body.diagnosis, 300);
  if (diagnosis.length < 3) errors.diagnosis = "Enter the diagnosis";
  if (Object.keys(errors).length) fail(errors);
  const { policy, insurer, tpa } = await checkPolicy(body.policy, patient._id, admissionDate ?? todayUtc());
  const now = new Date();
  const claim = new Claim({
    code: await nextCode("CLM"), claimType, patient: patient._id, patientName: patient.fullName, patientCode: patient.code,
    provider: insurer._id, providerName: insurer.name, tpa: tpa?._id, tpaName: tpa?.name, policy: policy._id, policyNumber: policy.policyNumber, memberId: policy.memberId,
    admissionDate: admissionDate ?? undefined, dischargeDate: dischargeDate ?? undefined, diagnosis, claimAmount, outstanding: claimAmount,
    documents: documentChecklist(false), status: "Pending Submission", remarks: text(body.remarks, 1000) || undefined,
    events: [{ at: now, action: "Raised", byName: user.name, note: `${claimType} claim for ${money(claimAmount)}` }],
    createdBy: user.id, updatedBy: user.id, createdByName: user.name,
  }) as unknown as CDoc;
  await saveDoc(claim, "claim");
  await audit(req, user, "claims", claim, `Raised ${claimType.toLowerCase()} claim ${claim.code} for ${claim.patientName} on ${insurer.name}: ${money(claimAmount)}`, "create");
  return getClaim(String(claim._id));
}

/** The receipt code Billing gave the settlement just posted. */
function lastSettlementCode(bill: unknown) {
  const receipts = ((bill as { receipts?: { kind: string; code: string }[] })?.receipts ?? []).filter((r) => r.kind === "Settlement");
  return receipts[receipts.length - 1]?.code;
}

/**
 * Actions: document | add-document | submit | review | query | respond | approve | settle | reject | cancel | note
 */
export async function claimAction(id: string, body: Record<string, unknown>, user: SessionUser, req: Request) {
  const claim = await loadClaim(id);
  if (!claim.documents.length && !["Settled", "Rejected", "Cancelled"].includes(claim.status)) claim.set("documents", documentChecklist(!!claim.preauth));
  const action = String(body.action ?? "");
  const now = new Date();
  const need = (...states: string[]) => {
    if (!states.includes(claim.status)) throw new ApiError(409, `Claim is ${claim.status.toLowerCase()}`);
  };
  const log = (act: string, note?: string) => claim.events.push({ at: now, action: act, byName: user.name, note });
  let summary = "";

  switch (action) {
    case "document": {
      need(...OPEN_CLAIM_STATUSES, "Approved", "Partially Settled");
      const doc = claim.documents.find((d) => d.name === body.name);
      if (!doc) throw new ApiError(404, "Document not in the checklist");
      doc.received = body.received === true;
      doc.receivedAt = doc.received ? now : undefined;
      doc.byName = doc.received ? user.name : undefined;
      summary = `${doc.received ? "Received" : "Unmarked"} "${doc.name}" for claim ${claim.code}`;
      break;
    }
    case "add-document": {
      need(...OPEN_CLAIM_STATUSES);
      const name = text(body.name, 80);
      if (name.length < 3) fail({ name: "Enter the document name" });
      if (claim.documents.some((d) => d.name.toLowerCase() === name.toLowerCase())) fail({ name: "Already in the checklist" });
      claim.documents.push({ name, required: body.required === true, received: false });
      summary = `Added "${name}" to the document checklist of claim ${claim.code}`;
      break;
    }
    case "submit": {
      need("Pending Submission");
      const missing = claim.documents.filter((d) => d.required && !d.received).map((d) => d.name);
      if (missing.length) throw new ApiError(422, `Collect the required documents first: ${missing.join(", ")}`);
      const on = parseDay(body.submittedDate) ?? todayUtc();
      if (on > todayUtc()) fail({ submittedDate: "Cannot be in the future" });
      const insurer = await Providers().findById(claim.provider).select("paymentTermsDays").lean<Doc>();
      claim.submittedDate = on;
      claim.dueDate = new Date(on.getTime() + Number(insurer?.paymentTermsDays ?? 30) * DAY);
      claim.status = "Submitted";
      log("Submitted", text(body.reference, 80) ? `Courier / portal ref ${text(body.reference, 80)}` : undefined);
      summary = `Submitted claim ${claim.code} (${money(claim.claimAmount)}) to ${claim.tpaName ?? claim.providerName}; due by ${claim.dueDate.toISOString().slice(0, 10)}`;
      break;
    }
    case "review":
      need("Submitted");
      claim.status = "Under Review";
      log("Under review", text(body.note, 200) || undefined);
      summary = `Claim ${claim.code} acknowledged and under review`;
      break;
    case "query": {
      need("Submitted", "Under Review", "Approved");
      const query = text(body.query, 1000);
      if (query.length < 3) fail({ query: "Enter the insurer's query" });
      claim.queries.push({ raisedAt: parseDay(body.raisedOn) ?? now, query, raisedByName: user.name });
      claim.status = "Query Raised";
      log("Query raised", query);
      summary = `Insurer query on claim ${claim.code}: ${query}`;
      break;
    }
    case "respond": {
      need("Query Raised");
      const response = text(body.response, 1000);
      if (response.length < 3) fail({ response: "Enter the reply sent to the insurer" });
      const open = [...claim.queries].reverse().find((q) => !q.response);
      if (!open) throw new ApiError(409, "No open query");
      Object.assign(open, { response, respondedAt: now, respondedByName: user.name });
      claim.status = typeof claim.approvedAmount === "number" && claim.approvedAmount > 0 ? "Approved" : "Under Review";
      log("Query answered", response);
      summary = `Answered the query on claim ${claim.code}`;
      break;
    }
    case "approve": {
      need("Submitted", "Under Review", "Query Raised");
      const amount = r2(num(body.approvedAmount));
      if (!(amount > 0)) fail({ approvedAmount: "Enter the amount approved" });
      if (amount > claim.claimAmount) fail({ approvedAmount: `Cannot exceed the ${money(claim.claimAmount)} claimed` });
      claim.approvedAmount = amount;
      claim.status = "Approved";
      log("Approved", money(amount));
      summary = `Claim ${claim.code} approved for ${money(amount)}${amount < claim.claimAmount ? ` (${money(claim.claimAmount - amount)} likely to be deducted)` : ""}`;
      break;
    }
    case "settle": {
      need("Submitted", "Under Review", "Approved", "Partially Settled");
      const outstanding = claimOutstanding(claim);
      const amount = r2(num(body.amount, 0));
      const tds = r2(num(body.tds, 0));
      const deduction = r2(num(body.deduction, 0));
      const toPatient = r2(num(body.toPatient, 0));
      const errors: Record<string, string> = {};
      for (const [k, v] of Object.entries({ amount, tds, deduction, toPatient })) if (!(v >= 0)) errors[k] = "Enter a valid amount";
      const total = r2(amount + tds + deduction + toPatient);
      if (!(total > 0)) errors.amount = "Enter the amount received";
      else if (total > outstanding + 0.005) errors.amount = `Received + TDS + deductions cannot exceed the ${money(outstanding)} outstanding`;
      const mode = String(body.mode ?? "");
      const utr = text(body.utr, 60);
      if (amount > 0 && !(SETTLE_MODES as readonly string[]).includes(mode)) errors.mode = "Select how the money was received";
      if (amount > 0 && !utr) errors.utr = "Enter the UTR / cheque number";
      const reason = text(body.reason, 300);
      if ((deduction > 0 || toPatient > 0) && reason.length < 3) errors.reason = "Enter the insurer's reasons for the deduction";
      const at = parseDay(body.date) ?? todayUtc();
      if (at > todayUtc()) errors.date = "Cannot be in the future";
      if (Object.keys(errors).length) fail(errors);

      let receiptCode: string | undefined;
      if (claim.bill) {
        // Billing records the payer's settlement on the bill: TDS and deductions are written off, disallowed items move to the patient.
        const parts = [tds ? `TDS ${money(tds)}` : "", deduction ? `deducted ${money(deduction)}` : "", toPatient ? `to patient ${money(toPatient)}` : "", reason].filter(Boolean).join("; ");
        const updated = await billAction(
          String(claim.bill),
          { action: "receipt", kind: "Settlement", splits: amount > 0 ? [{ mode, amount, reference: utr }] : [], writeOff: r2(tds + deduction), toPatient, reason: `Claim ${claim.code}${parts ? `: ${parts}` : ""}` },
          user,
          req
        );
        receiptCode = lastSettlementCode(updated);
      }
      claim.settlements.push({ at, amount, tds, deduction, toPatient, mode: amount > 0 ? mode : undefined, utr: utr || undefined, reason: reason || undefined, receiptCode, byName: user.name });
      claim.settledAmount = r2((claim.settledAmount ?? 0) + amount);
      claim.tdsAmount = r2((claim.tdsAmount ?? 0) + tds);
      claim.deductionAmount = r2((claim.deductionAmount ?? 0) + deduction);
      claim.patientAmount = r2((claim.patientAmount ?? 0) + toPatient);
      claim.outstanding = claimOutstanding(claim);
      claim.status = claim.outstanding > 0 ? "Partially Settled" : "Settled";
      if (claim.status === "Settled") claim.settledDate = at;
      const note = [`received ${money(amount)}${utr ? ` (${mode} ${utr})` : ""}`, tds ? `TDS ${money(tds)}` : "", deduction ? `deduction ${money(deduction)}` : "", toPatient ? `${money(toPatient)} moved to patient` : ""].filter(Boolean).join(", ");
      log(claim.status === "Settled" ? "Settled" : "Part settlement", `${note}${receiptCode ? ` · bill receipt ${receiptCode}` : ""}`);
      summary = `Settlement on claim ${claim.code}: ${note}; outstanding ${money(claim.outstanding)}${receiptCode ? `; posted to bill ${claim.billCode} as ${receiptCode}` : ""}`;
      break;
    }
    case "reject": {
      need("Submitted", "Under Review", "Query Raised", "Approved");
      const reason = text(body.reason, 500);
      if (reason.length < 3) fail({ reason: "Enter the insurer's reason" });
      claim.status = "Rejected";
      claim.rejectReason = reason;
      summary = `Claim ${claim.code} rejected by ${claim.tpaName ?? claim.providerName}: ${reason}`;
      const outstanding = claimOutstanding(claim);
      if (body.moveToPatient === true && outstanding > 0) {
        if (claim.bill) {
          const bill = await Bill.findById(claim.bill).select("payerDue").lean();
          const due = r2(Math.min(outstanding, bill?.payerDue ?? 0));
          if (due > 0) {
            const updated = await billAction(String(claim.bill), { action: "receipt", kind: "Settlement", splits: [], toPatient: due, reason: `Claim ${claim.code} rejected: ${reason}` }, user, req);
            claim.settlements.push({ at: todayUtc(), amount: 0, tds: 0, deduction: 0, toPatient: due, reason: `Rejected: ${reason}`, receiptCode: lastSettlementCode(updated), byName: user.name });
            claim.patientAmount = r2((claim.patientAmount ?? 0) + due);
            summary += `; ${money(due)} moved to the patient on bill ${claim.billCode}`;
          }
        } else {
          claim.patientAmount = r2((claim.patientAmount ?? 0) + outstanding);
        }
      }
      claim.outstanding = claimOutstanding(claim);
      log("Rejected", reason);
      break;
    }
    case "cancel": {
      need("Pending Submission");
      if (claim.settlements.length) throw new ApiError(409, "Settlements are recorded on this claim");
      const reason = text(body.reason, 300);
      if (reason.length < 3) fail({ reason: "Enter the reason for cancelling" });
      claim.status = "Cancelled";
      claim.outstanding = 0;
      log("Cancelled", reason);
      if (claim.bill) await Bill.updateOne({ _id: claim.bill, claim: claim._id }, { $unset: { claim: 1, claimCode: 1 } });
      summary = `Cancelled claim ${claim.code}. Reason: ${reason}`;
      break;
    }
    case "note": {
      const note = text(body.note, 500);
      if (note.length < 3) fail({ note: "Enter the note" });
      log("Note", note);
      summary = `Note on claim ${claim.code}: ${note}`;
      break;
    }
    default:
      throw new ApiError(400, "Unknown action");
  }
  claim.updatedBy = new Types.ObjectId(user.id);
  await saveDoc(claim, "claim");
  await audit(req, user, "claims", claim, summary);
  return getClaim(id);
}

/* ======================= reports ======================= */

export async function insuranceReports(url: URL) {
  const today = todayUtc();
  const from = parseDay(url.searchParams.get("from")) ?? new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const to = parseDay(url.searchParams.get("to")) ?? today;
  if (to < from) fail({ to: "End date cannot be before the start date" });
  const end = new Date(to.getTime() + DAY);

  const [open, settledInPeriod, raised, preauths, expiring] = await Promise.all([
    Claim.find({ status: { $nin: ["Settled", "Rejected", "Cancelled"] } }).select("code provider providerName tpaName claimAmount settledAmount tdsAmount deductionAmount patientAmount outstanding submittedDate dueDate status").lean(),
    Claim.find({ "settlements.at": { $gte: from, $lt: end } }).select("code providerName submittedDate settlements claimAmount status").lean(),
    Claim.find({ createdAt: { $gte: from, $lt: end } }).select("providerName claimAmount status").lean(),
    PreAuth.find({ createdAt: { $gte: from, $lt: end } }).select("status requestedAmount approvedAmount submittedAt approvedAt decisionAt insurerName tpaName enhancements").lean(),
    Policies().find({ status: "Active", validTo: { $gte: today, $lte: new Date(today.getTime() + 30 * DAY) } }).sort({ validTo: 1 }).limit(50).populate([{ path: "patient", select: "fullName code" }, { path: "insurer", select: "name" }]).lean<Doc[]>(),
  ]);

  // Ageing of what insurers still owe, from the submission date.
  const buckets = ["Not submitted", "0–30 days", "31–60 days", "61–90 days", "Over 90 days"] as const;
  const bucketOf = (c: (typeof open)[number]) => {
    if (!c.submittedDate) return buckets[0];
    const age = (today.getTime() - c.submittedDate.getTime()) / DAY;
    return age <= 30 ? buckets[1] : age <= 60 ? buckets[2] : age <= 90 ? buckets[3] : buckets[4];
  };
  const byInsurer = new Map<string, { label: string; claims: number; outstanding: number; overdue: number; buckets: Record<string, number> }>();
  for (const c of open) {
    const label = c.tpaName ? `${c.providerName ?? "—"} / ${c.tpaName}` : (c.providerName ?? "—");
    const row = byInsurer.get(label) ?? { label, claims: 0, outstanding: 0, overdue: 0, buckets: Object.fromEntries(buckets.map((b) => [b, 0])) };
    const amount = c.outstanding ?? claimOutstanding(c);
    row.claims++;
    row.outstanding = r2(row.outstanding + amount);
    row.buckets[bucketOf(c)] = r2(row.buckets[bucketOf(c)] + amount);
    if (c.dueDate && c.dueDate < today && c.submittedDate) row.overdue = r2(row.overdue + amount);
    byInsurer.set(label, row);
  }

  const settlements = settledInPeriod.flatMap((c) => c.settlements.filter((s) => s.at >= from && s.at < end).map((s) => ({ c, s })));
  const sum = (k: "amount" | "tds" | "deduction" | "toPatient") => r2(settlements.reduce((t, x) => t + (x.s[k] ?? 0), 0));
  const tat = settledInPeriod.filter((c) => c.status === "Settled" && c.submittedDate).map((c) => {
    const last = c.settlements[c.settlements.length - 1];
    return last ? (last.at.getTime() - c.submittedDate!.getTime()) / DAY : null;
  }).filter((n): n is number => n !== null);
  const decided = preauths.filter((p) => p.decisionAt && p.submittedAt);
  const status = (rows: { status: string }[]) => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.status, (m.get(r.status) ?? 0) + 1);
    return [...m].map(([label, n]) => ({ label, n }));
  };
  const claimed = r2(raised.reduce((s, c) => s + c.claimAmount, 0));
  const received = sum("amount");
  const deducted = r2(sum("deduction") + sum("toPatient"));

  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    totals: {
      outstanding: r2(open.reduce((s, c) => s + (c.outstanding ?? claimOutstanding(c)), 0)),
      openClaims: open.length,
      overdue: r2([...byInsurer.values()].reduce((s, r) => s + r.overdue, 0)),
      notSubmitted: open.filter((c) => !c.submittedDate).length,
      claimsRaised: raised.length,
      claimed,
      received,
      tds: sum("tds"),
      deductions: sum("deduction"),
      toPatient: sum("toPatient"),
      deductionPct: received + deducted ? r2((deducted / (received + deducted + sum("tds"))) * 100) : null,
      avgSettlementDays: tat.length ? Math.round(tat.reduce((s, x) => s + x, 0) / tat.length) : null,
      preauths: preauths.length,
      preauthApprovalPct: decided.length ? r2((decided.filter((p) => p.approvedAmount > 0).length / decided.length) * 100) : null,
      preauthRequested: r2(preauths.reduce((s, p) => s + p.requestedAmount, 0)),
      preauthApproved: r2(preauths.reduce((s, p) => s + (p.approvedAmount ?? 0), 0)),
      avgDecisionHours: decided.length ? r2(decided.reduce((s, p) => s + (p.decisionAt!.getTime() - p.submittedAt!.getTime()) / 3_600_000, 0) / decided.length) : null,
      enhancements: preauths.reduce((s, p) => s + p.enhancements.length, 0),
    },
    buckets,
    ageing: [...byInsurer.values()].sort((a, b) => b.outstanding - a.outstanding),
    claimStatus: status(raised),
    preauthStatus: status(preauths),
    settlements: settlements.slice(0, 100).map(({ c, s }) => ({ claimId: String(c._id), code: c.code, insurer: c.providerName ?? "—", at: s.at.toISOString(), amount: s.amount, tds: s.tds, deduction: s.deduction, toPatient: s.toPatient, utr: s.utr ?? null, reason: s.reason ?? null })),
    expiringPolicies: expiring.map((p) => ({
      id: String(p._id), policyNumber: String(p.policyNumber), validTo: iso(p.validTo),
      patient: p.patient && typeof p.patient === "object" ? `${(p.patient as Doc).fullName} (${(p.patient as Doc).code ?? ""})` : "—",
      insurer: p.insurer && typeof p.insurer === "object" ? String((p.insurer as Doc).name) : "—",
    })),
  };
}

/** Pre-auths and claims of one patient (patient page). */
export async function patientInsurance(patientId: Types.ObjectId) {
  const [pre, claims, preTotal, claimTotal] = await Promise.all([
    PreAuth.find({ patient: patientId }).sort({ createdAt: -1 }).limit(10).lean(),
    Claim.find({ patient: patientId }).sort({ createdAt: -1 }).limit(10).lean(),
    PreAuth.countDocuments({ patient: patientId }),
    Claim.countDocuments({ patient: patientId }),
  ]);
  return {
    preauths: { total: preTotal, items: pre.map((d) => preauthRow(d as unknown as Record<string, unknown>)) },
    claims: { total: claimTotal, items: claims.map((d) => claimRow(d as unknown as Record<string, unknown>)) },
  };
}
