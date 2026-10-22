import "server-only";
import type { Types } from "mongoose";
import { ACCOUNTS_RULES } from "./accounts";
import { ApiError, escapeRegex } from "./api";
import { normalizePin } from "./biometric";
import { WEEKDAYS, type RecordValues } from "./modules";
import { WORKING_STATUSES, assertAvailable, assertMonthOpen, checkLeaveBalance, countLeaveDays, rosteredShifts } from "./hr";
import { billOutstanding } from "./inventory";
import { ACTIVE_TRIP_STATUSES, Trip } from "@/models/ambulance";
import { Bill } from "@/models/billing";
import { nextSerial } from "@/models/Counter";
import { Attendance, PayrollRun } from "@/models/hr";
import { Claim, PreAuth } from "@/models/insurance";
import { Ledger, StockDoc } from "@/models/inventory";
import { LabOrder } from "@/models/laboratory";
import { Purchase, Sale } from "@/models/pharmacy";
import { getRecordModel } from "@/models/records";

/**
 * Resource-specific business rules, keyed by "module.resource".
 * The generic record service (records.ts) calls these hooks around every
 * list / create / update / delete, which is how modules talk to each other.
 */

export type Doc = Record<string, unknown> & { _id: Types.ObjectId };

export interface ResourceRules {
  /** Runs before listing / lookups (e.g. to expire stale stock). */
  beforeList?: () => Promise<void>;
  /** Validate or adjust values. `existing` is null on create. Throw ApiError to reject. */
  beforeSave?: (values: RecordValues, existing: Doc | null) => Promise<void>;
  /** Undo side effects of beforeSave if the record could not be written. */
  rollback?: (values: RecordValues, existing: Doc | null) => Promise<void>;
  afterSave?: (doc: Doc, existing: Doc | null) => Promise<void>;
  beforeDelete?: (existing: Doc) => Promise<void>;
  afterDelete?: (existing: Doc) => Promise<void>;
}

const M = (module: string, resource: string) => getRecordModel(module, resource)!;

function startOfToday() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function reject(field: string, message: string): never {
  throw new ApiError(422, message, { [field]: message });
}

/** Lead statuses after which a new enquiry from the same person opens a fresh lead. */
const CLOSED_LEADS = ["Converted", "Not interested", "Lost"];
/** Lead status after a follow-up with this outcome. */
const FOLLOWUP_STATUS: Record<string, string> = { Interested: "Follow-up", "Call back later": "Follow-up", "Not reachable": "Contacted", "Appointment booked": "Appointment booked", "Not interested": "Not interested" };

/** Excludes the record being edited from duplicate / clash queries. */
function notSelf(existing: Doc | null) {
  return existing ? { _id: { $ne: existing._id } } : {};
}

function isoDate(v: unknown) {
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
}

function minutes(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function blockIfReferenced(count: number, what: string) {
  if (count > 0) throw new ApiError(409, `Cannot delete: ${count} ${what} still reference this record.`);
}

/* ---------- Laboratory stock & QC ---------- */

const REAGENT_SIGN: Record<string, 1 | -1> = { "Stock In": 1, "Adjustment (+)": 1, Consumed: -1, "Wasted / Expired": -1, "Adjustment (-)": -1 };

function reagentStatus(r: Record<string, unknown>) {
  const qty = Number(r.quantity ?? 0);
  if (r.expiryDate instanceof Date && r.expiryDate < startOfToday()) return "Expired";
  if (qty <= 0) return "Out of Stock";
  if (typeof r.reorderLevel === "number" && qty <= r.reorderLevel) return "Low Stock";
  return "In Stock";
}

/** Apply a stock movement atomically; outflows never take stock below zero. */
async function moveReagent(id: unknown, delta: number, name = "this item") {
  const R = M("laboratory", "reagents");
  const guard = delta < 0 ? { quantity: { $gte: -delta } } : {};
  const res = await R.updateOne({ _id: id, ...guard }, { $inc: { quantity: delta } });
  if (res.modifiedCount === 0) reject("quantity", `Not enough ${name} in stock`);
  const r = await R.findById(id).lean<Doc>();
  if (r) await R.updateOne({ _id: id }, { $set: { quantity: Math.round(Number(r.quantity) * 100) / 100, status: reagentStatus(r) } });
}

/* ---------- Blood compatibility ---------- */

const ABO = (group: string) => group.replace(/[+-]$/, "");
const RH_POSITIVE = (group: string) => group.endsWith("+");
const ANTIGENS: Record<string, string[]> = { O: [], A: ["A"], B: ["B"], AB: ["A", "B"] };

/**
 * Standard ABO/Rh compatibility for issuing a bag to a recipient.
 * Red cells: donor antigens must be a subset of the recipient's.
 * Plasma / cryo: donor plasma must not carry antibodies against recipient antigens.
 * Platelets: plasma rule for ABO, plus Rh-negative recipients get Rh-negative bags.
 */
export function isCompatible(recipient: string, donor: string, component: string) {
  const r = ANTIGENS[ABO(recipient)] ?? [];
  const d = ANTIGENS[ABO(donor)] ?? [];
  const rhOk = RH_POSITIVE(recipient) || !RH_POSITIVE(donor);
  if (component === "Whole Blood" || component === "Packed RBC") return d.every((a) => r.includes(a)) && rhOk;
  if (component === "Platelets") return r.every((a) => d.includes(a)) && rhOk;
  return r.every((a) => d.includes(a));
}

async function expireBloodUnits() {
  await M("blood_bank", "units").updateMany(
    { status: { $in: ["Available", "Reserved"] }, expiryDate: { $lt: startOfToday() } },
    { $set: { status: "Expired" } }
  );
}

async function refreshRequestStatus(requestId: unknown) {
  const request = await M("blood_bank", "requests").findById(requestId).lean<Doc>();
  if (!request || request.status === "Cancelled") return;
  const issued = await M("blood_bank", "issues").countDocuments({ request: request._id });
  const status = issued === 0 ? "Pending" : issued >= Number(request.unitsRequired ?? 1) ? "Issued" : "Partially Issued";
  if (status !== request.status) await M("blood_bank", "requests").updateOne({ _id: request._id }, { $set: { status } });
}

const SYSTEM_REQUEST_STATUSES = ["Partially Issued", "Issued"];

/* ---------- HR ---------- */

const SALARY_PARTS = ["basicPay", "da", "hra", "specialAllowance", "otherAllowance"];
const LEFT = ["Resigned", "Terminated"];

async function staffDoc(id: unknown, field: string) {
  const s = await M("hr", "staff").findById(id).lean<Doc>();
  if (!s) reject(field, "Employee not found");
  return s;
}

/* ---------- Ambulance fleet ---------- */

async function vehicleDoc(id: unknown) {
  const v = await M("ambulance", "vehicles").findById(id).lean<Doc>();
  if (!v) reject("vehicle", "Vehicle not found");
  return v;
}

/** Back on the road once no workshop job is open (never while on a trip). */
async function releaseFromWorkshop(vehicleId: unknown, exceptJob: unknown) {
  const open = await M("ambulance", "maintenance").countDocuments({ vehicle: vehicleId, status: "In Workshop", _id: { $ne: exceptJob } });
  if (!open) await M("ambulance", "vehicles").updateOne({ _id: vehicleId, status: "Maintenance" }, { $set: { status: "Available" } });
}

export const RULES: Record<string, ResourceRules> = {
  "patients.patients": {
    beforeSave: async (v, existing) => {
      if (existing) return;
      const dup = await M("patients", "patients")
        .findOne({ fullName: new RegExp(`^${escapeRegex(String(v.fullName))}$`, "i"), dateOfBirth: v.dateOfBirth, mobile: v.mobile })
        .select("code")
        .lean<Doc>();
      if (dup) throw new ApiError(409, `This patient appears to be registered already (${dup.code}).`);
    },
    beforeDelete: async (d) => {
      blockIfReferenced(await Sale.countDocuments({ patient: d._id }), "pharmacy bill(s)");
      blockIfReferenced(await LabOrder.countDocuments({ patient: d._id }), "lab order(s)");
      blockIfReferenced(await Bill.countDocuments({ patient: d._id }), "hospital bill(s)");
      blockIfReferenced(await PreAuth.countDocuments({ patient: d._id }), "insurance pre-auth(s)");
      blockIfReferenced(await Claim.countDocuments({ patient: d._id }), "insurance claim(s)");
      blockIfReferenced(await Trip.countDocuments({ patient: d._id }), "ambulance trip(s)");
    },
  },

  "doctors.doctors": {
    beforeSave: async (v, existing) => {
      if (typeof v.registrationNo === "string") {
        const dup = await M("doctors", "doctors")
          .findOne({ registrationNo: new RegExp(`^${escapeRegex(v.registrationNo)}$`, "i"), ...notSelf(existing) })
          .select("code fullName")
          .lean<Doc>();
        if (dup) reject("registrationNo", `Already registered to ${dup.fullName} (${dup.code})`);
      }
      if (existing && v.status === "Inactive" && existing.status !== "Inactive") {
        const upcoming = await M("doctors", "appointments").countDocuments({ doctor: existing._id, status: "Scheduled", date: { $gte: startOfToday() } });
        if (upcoming) reject("status", `${upcoming} upcoming appointment(s) are scheduled. Cancel or reassign them first.`);
      }
    },
    beforeDelete: async (d) => blockIfReferenced(await Sale.countDocuments({ doctor: d._id }), "pharmacy bill(s)"),
  },

  "doctors.appointments": {
    beforeSave: async (v, existing) => {
      const m = { ...(existing ?? {}), ...v } as RecordValues;
      if (m.status !== "Scheduled") return;
      // Editing only the reason of an existing booking does not re-check availability.
      if (existing && ["doctor", "date", "time", "status"].every((k) => v[k] === undefined)) return;

      const doctor = await M("doctors", "doctors").findById(m.doctor).lean<Doc>();
      if (!doctor || !(m.date instanceof Date)) return;
      const name = String(doctor.fullName);
      const date = m.date;
      const time = String(m.time);
      if (doctor.status === "Inactive") reject("doctor", `${name} is inactive`);

      const day = WEEKDAYS[date.getUTCDay()];
      const days = doctor.workingDays ? String(doctor.workingDays).split(",") : null;
      if (days && !days.includes(day)) reject("date", `${name} does not work on ${day} (works ${days.join(", ")})`);
      if (typeof doctor.startTime === "string" && typeof doctor.endTime === "string" && (time < doctor.startTime || time >= doctor.endTime)) {
        reject("time", `Outside ${name}'s working hours (${doctor.startTime}–${doctor.endTime})`);
      }

      const leave = await M("doctors", "leaves")
        .findOne({ doctor: doctor._id, status: "Approved", fromDate: { $lte: date }, toDate: { $gte: date } })
        .select("code fromDate toDate")
        .lean<Doc>();
      if (leave) reject("date", `${name} is on approved leave ${isoDate(leave.fromDate)} to ${isoDate(leave.toDate)} (${leave.code})`);

      const sameDay = await M("doctors", "appointments")
        .find({ doctor: doctor._id, date, status: { $in: ["Scheduled", "Completed"] }, ...notSelf(existing) })
        .select("code time status")
        .lean<Doc[]>();
      const slot = typeof doctor.slotMinutes === "number" ? doctor.slotMinutes : 0;
      const clash = sameDay.find((a) => a.status === "Scheduled" && (slot ? Math.abs(minutes(String(a.time)) - minutes(time)) < slot : a.time === time));
      if (clash) reject("time", `Clashes with ${clash.code} at ${clash.time}${slot ? ` (${slot}-minute slots)` : ""}`);
      if (typeof doctor.maxPatientsPerDay === "number" && sameDay.length >= doctor.maxPatientsPerDay) {
        reject("date", `${name} is fully booked on this day (${doctor.maxPatientsPerDay} appointments)`);
      }
    },
  },

  "doctors.leaves": {
    beforeSave: async (v, existing) => {
      const m = { ...(existing ?? {}), ...v } as RecordValues;
      if (!(m.fromDate instanceof Date) || !(m.toDate instanceof Date)) return;
      const from = m.fromDate;
      const to = m.toDate;
      if (!existing || v.fromDate !== undefined || v.toDate !== undefined) v.days = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
      if (m.status !== "Pending" && m.status !== "Approved") return;

      const overlap = await M("doctors", "leaves")
        .findOne({ doctor: m.doctor, status: { $in: ["Pending", "Approved"] }, fromDate: { $lte: to }, toDate: { $gte: from }, ...notSelf(existing) })
        .select("code")
        .lean<Doc>();
      if (overlap) reject("fromDate", `Overlaps leave ${overlap.code}`);

      if (m.status === "Approved") {
        const booked = await M("doctors", "appointments").countDocuments({ doctor: m.doctor, status: "Scheduled", date: { $gte: from, $lte: to } });
        if (booked) reject("status", `${booked} scheduled appointment(s) fall in this period. Reschedule or cancel them before approving.`);
      }
    },
  },

  "laboratory.tests": {
    beforeSave: async (v) => {
      if (typeof v.testCode === "string") v.testCode = v.testCode.toUpperCase();
    },
    beforeDelete: async (d) => blockIfReferenced(await LabOrder.countDocuments({ "items.test": d._id }), "lab order(s)"),
  },

  "laboratory.profiles": {
    beforeDelete: async (d) => blockIfReferenced(await LabOrder.countDocuments({ "items.profile": d._id }), "lab order(s)"),
  },

  "laboratory.outsource_labs": {
    beforeDelete: async (d) => blockIfReferenced(await LabOrder.countDocuments({ "items.outsourceLab": d._id }), "lab order(s)"),
  },

  "laboratory.qc": {
    beforeSave: async (v, existing) => {
      const m = { ...(existing ?? {}), ...v } as RecordValues;
      const mean = Number(m.targetMean);
      const sd = Number(m.sd);
      const z = Math.round(((Number(m.observed) - mean) / sd) * 100) / 100;
      v.zScore = z;
      // Westgard: 1-3s rejects; 2-2s (this and the previous run beyond 2 SD on the same side) rejects; 1-2s warns.
      const prev = await M("laboratory", "qc")
        .findOne({ test: m.test, analyte: m.analyte, equipment: m.equipment, controlLevel: m.controlLevel, runDate: { $lte: m.runDate }, ...notSelf(existing) })
        .sort({ runDate: -1, createdAt: -1 })
        .select("zScore")
        .lean<Doc>();
      const pz = typeof prev?.zScore === "number" ? prev.zScore : 0;
      if (Math.abs(z) > 3) [v.result, v.ruleViolated] = ["Fail", "1-3s"];
      else if (Math.abs(z) > 2 && Math.abs(pz) > 2 && Math.sign(z) === Math.sign(pz)) [v.result, v.ruleViolated] = ["Fail", "2-2s"];
      else if (Math.abs(z) > 2) [v.result, v.ruleViolated] = ["Warning", "1-2s"];
      else [v.result, v.ruleViolated] = ["Pass", "—"];
    },
  },

  "laboratory.reagents": {
    beforeList: async () => {
      await M("laboratory", "reagents").updateMany({ expiryDate: { $lt: startOfToday() }, status: { $ne: "Expired" } }, { $set: { status: "Expired" } });
    },
    beforeSave: async (v, existing) => {
      v.status = reagentStatus({ ...(existing ?? {}), ...v } as RecordValues);
    },
  },

  "laboratory.reagent_stock": {
    beforeSave: async (v, existing) => {
      if (existing) {
        if (["reagent", "txnType", "quantity"].some((k) => v[k] !== undefined && String(v[k]) !== String(existing[k]))) {
          throw new ApiError(422, "To change the item, type or quantity, delete this entry and record a new one.");
        }
        return;
      }
      const r = await M("laboratory", "reagents").findById(v.reagent).select("name").lean<Doc>();
      await moveReagent(v.reagent, REAGENT_SIGN[String(v.txnType)] * Number(v.quantity), r ? String(r.name) : undefined);
    },
    rollback: async (v, existing) => {
      if (!existing) await moveReagent(v.reagent, -REAGENT_SIGN[String(v.txnType)] * Number(v.quantity));
    },
    beforeDelete: async (d) => {
      // Reversing a stock-in must not leave negative stock (it may already be consumed).
      await moveReagent(d.reagent, -REAGENT_SIGN[String(d.txnType)] * Number(d.quantity), "of it left to reverse this entry");
    },
  },

  "inventory.items": {
    beforeSave: async (v, existing) => {
      const m = { ...(existing ?? {}), ...v } as RecordValues;
      if (typeof v.sku === "string") v.sku = v.sku.toUpperCase();
      if (!m.sku) {
        const cat = await M("inventory", "categories").findById(m.category).select("code").lean<Doc>();
        const prefix = String(cat?.code ?? "ITM").toUpperCase();
        v.sku = `${prefix}-${String(await nextSerial(`SKU-${prefix}`)).padStart(5, "0")}`;
      }
      if (!m.barcode && (v.sku || m.sku)) v.barcode = String(v.sku ?? m.sku);
      if (m.subcategory && (v.subcategory !== undefined || v.category !== undefined)) {
        const sub = await M("inventory", "subcategories").findById(m.subcategory).select("category name").lean<Doc>();
        if (sub && String(sub.category) !== String(m.category)) reject("subcategory", `${sub.name} belongs to a different category`);
      }
    },
    beforeDelete: async (d) => {
      blockIfReferenced(await StockDoc.countDocuments({ "lines.item": d._id }), "stock document(s)");
      blockIfReferenced(await Ledger.countDocuments({ item: d._id }), "stock ledger entr(ies)");
      blockIfReferenced(await Purchase.countDocuments({ "items.item": d._id }), "purchase entr(ies)");
      blockIfReferenced(await Sale.countDocuments({ "items.item": d._id }), "sale bill(s)");
    },
  },

  "inventory.suppliers": {
    beforeDelete: async (d) => {
      blockIfReferenced(await Purchase.countDocuments({ supplier: d._id }), "purchase entr(ies)");
      blockIfReferenced(await StockDoc.countDocuments({ supplier: d._id }), "purchase order / GRN document(s)");
    },
  },

  "inventory.categories": {
    beforeSave: async (v) => {
      if (typeof v.code === "string") {
        v.code = v.code.toUpperCase();
        if (!/^[A-Z]{2,5}$/.test(v.code)) reject("code", "Use 2–5 letters, e.g. MED");
      }
    },
  },

  "inventory.stores": {
    beforeDelete: async (d) => blockIfReferenced(await StockDoc.countDocuments({ $or: [{ store: d._id }, { toStore: d._id }] }), "stock document(s)"),
  },

  "inventory.supplier_payments": {
    beforeSave: async (v, existing) => {
      const m = { ...(existing ?? {}), ...v } as RecordValues;
      if (typeof v.billRef === "string") v.billRef = v.billRef.trim().toUpperCase() || null;
      const ref = (v.billRef ?? m.billRef) as string | null;
      if (!ref) return;
      const bill = await billOutstanding(ref);
      if (!bill) reject("billRef", `No posted GRN or pharmacy purchase ${ref}`);
      if (String(bill.supplier) !== String(m.supplier)) reject("billRef", `${ref} belongs to a different supplier`);
      const [others] = await M("inventory", "supplier_payments").aggregate<{ s: number }>([
        { $match: { billRef: ref, ...(existing ? { _id: { $ne: existing._id } } : {}) } },
        { $group: { _id: null, s: { $sum: "$amount" } } },
      ]);
      const balance = Math.round((bill.amount - bill.returns - (others?.s ?? 0)) * 100) / 100;
      if (Number(m.amount) > balance) reject("amount", balance > 0 ? `Only ₹${balance} is due on ${ref}` : `${ref} is already fully paid`);
    },
  },

  "blood_bank.units": {
    beforeList: expireBloodUnits,
    beforeSave: async (v, existing) => {
      const merged = { ...(existing ?? {}), ...v } as RecordValues;
      if (v.status === "Issued" && existing?.status !== "Issued") reject("status", "Bags are marked Issued by creating a Blood Issue");
      if (existing?.status === "Issued" && v.status !== undefined && v.status !== "Issued") {
        reject("status", "This bag is issued. Delete its Blood Issue record to return it to stock.");
      }
      if (merged.donor && (v.donor !== undefined || v.bloodGroup !== undefined)) {
        const donor = await M("blood_bank", "donors").findById(merged.donor).lean<Doc>();
        if (donor && donor.bloodGroup !== merged.bloodGroup) reject("donor", `Donor is ${donor.bloodGroup}; bag group must match`);
        if (donor && !existing && donor.status === "Permanently Deferred") reject("donor", "This donor is permanently deferred");
      }
      if (merged.status === "Available" && merged.expiryDate instanceof Date && merged.expiryDate < startOfToday()) {
        v.status = "Expired";
      }
    },
    afterSave: async (doc, existing) => {
      if (existing || !doc.donor || !(doc.collectionDate instanceof Date)) return;
      await M("blood_bank", "donors").updateOne(
        { _id: doc.donor, $or: [{ lastDonationDate: { $exists: false } }, { lastDonationDate: null }, { lastDonationDate: { $lt: doc.collectionDate } }] },
        { $set: { lastDonationDate: doc.collectionDate } }
      );
    },
  },

  "blood_bank.requests": {
    beforeSave: async (v, existing) => {
      if (v.status !== undefined && SYSTEM_REQUEST_STATUSES.includes(String(v.status)) && v.status !== existing?.status) {
        reject("status", "This status is set automatically when bags are issued");
      }
      if (existing && v.status === "Cancelled" && existing.status !== "Cancelled") {
        const issued = await M("blood_bank", "issues").countDocuments({ request: existing._id });
        if (issued > 0) reject("status", `${issued} bag(s) already issued. Delete those issues before cancelling.`);
      }
      if (!existing && v.status === undefined) v.status = "Pending";
    },
    afterSave: async (doc, existing) => {
      if (existing && existing.unitsRequired !== doc.unitsRequired) await refreshRequestStatus(doc._id);
    },
  },

  "blood_bank.issues": {
    beforeSave: async (v, existing) => {
      if (existing) {
        if ((v.unit && String(v.unit) !== String(existing.unit)) || (v.request && String(v.request) !== String(existing.request))) {
          throw new ApiError(422, "To change the bag or request, delete this issue and create a new one.");
        }
        return;
      }
      const request = await M("blood_bank", "requests").findById(v.request).lean<Doc>();
      if (!request) reject("request", "Blood request not found");
      if (request.status === "Cancelled" || request.status === "Issued") reject("request", `Request is already ${String(request.status).toLowerCase()}`);

      const unit = await M("blood_bank", "units").findById(v.unit).lean<Doc>();
      if (!unit) reject("unit", "Blood bag not found");
      if (unit.screening !== "Passed") reject("unit", "Bag has not passed screening");
      if (unit.expiryDate instanceof Date && unit.expiryDate < startOfToday()) reject("unit", "Bag has expired");
      if (unit.component !== request.component) reject("unit", `Request needs ${request.component}; this bag is ${unit.component}`);
      if (!isCompatible(String(request.bloodGroup), String(unit.bloodGroup), String(request.component))) {
        reject("unit", `${unit.bloodGroup} ${unit.component} is not compatible with a ${request.bloodGroup} patient`);
      }
      // Claim the bag atomically so two issues can never take the same bag.
      const claimed = await M("blood_bank", "units").updateOne({ _id: unit._id, status: "Available" }, { $set: { status: "Issued" } });
      if (claimed.modifiedCount === 0) reject("unit", "This bag is no longer available");
    },
    rollback: async (v, existing) => {
      if (!existing && v.unit) await M("blood_bank", "units").updateOne({ _id: v.unit, status: "Issued" }, { $set: { status: "Available" } });
    },
    afterSave: async (doc, existing) => {
      if (!existing) await refreshRequestStatus(doc.request);
    },
    afterDelete: async (d) => {
      const unit = await M("blood_bank", "units").findById(d.unit).lean<Doc>();
      if (unit?.status === "Issued") {
        const expired = unit.expiryDate instanceof Date && unit.expiryDate < startOfToday();
        await M("blood_bank", "units").updateOne({ _id: unit._id }, { $set: { status: expired ? "Expired" : "Available" } });
      }
      await refreshRequestStatus(d.request);
    },
  },

  /* ---------- HR ---------- */

  "hr.staff": {
    beforeSave: async (v, existing) => {
      const m = { ...(existing ?? {}), ...v } as RecordValues;
      for (const k of ["pan", "ifsc"]) if (typeof v[k] === "string") v[k] = (v[k] as string).toUpperCase().replace(/\s/g, "");
      if (typeof v.pan === "string" && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(v.pan)) reject("pan", "Enter a valid PAN, e.g. ABCDE1234F");
      if (typeof v.ifsc === "string" && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(v.ifsc)) reject("ifsc", "Enter a valid IFSC, e.g. SBIN0001234");
      if (typeof v.aadhaarLast4 === "string" && !/^\d{4}$/.test(v.aadhaarLast4)) reject("aadhaarLast4", "Enter exactly 4 digits");
      if (m.salaryMode === "Bank Transfer" && (v.salaryMode !== undefined || v.accountNo !== undefined || v.ifsc !== undefined) && (!m.accountNo || !m.ifsc)) {
        reject("accountNo", "Bank transfer needs the account number and IFSC");
      }
      if (existing && m.reportingTo && String(m.reportingTo) === String(existing._id)) reject("reportingTo", "Cannot report to themselves");
      if (SALARY_PARTS.some((k) => k in v)) v.salary = Math.round(SALARY_PARTS.reduce((s, k) => s + (typeof m[k] === "number" ? (m[k] as number) : 0), 0) * 100) / 100;
      if (m.doctor && v.doctor !== undefined) {
        const dup = await M("hr", "staff").findOne({ doctor: m.doctor, ...notSelf(existing) }).select("code fullName").lean<Doc>();
        if (dup) reject("doctor", `Already linked to ${dup.fullName} (${dup.code})`);
      }
      if (typeof v.biometricId === "string" && v.biometricId) {
        // Machines drop leading zeros, so "042" and "42" are the same person.
        const pin = normalizePin(v.biometricId);
        if (!pin) reject("biometricId", "Use letters and digits only, as enrolled on the machine");
        const others = await M("hr", "staff").find({ biometricId: { $nin: [null, ""] }, ...notSelf(existing) }).select("code fullName biometricId").lean<Doc[]>();
        const dup = others.find((s) => normalizePin(s.biometricId) === pin);
        if (dup) reject("biometricId", `Already used by ${dup.fullName} (${dup.code})`);
      }
      // Leaving: nothing may still depend on this person after the last working day.
      if (existing && LEFT.includes(String(m.status)) && (v.status !== undefined || v.exitDate !== undefined)) {
        const exit = m.exitDate instanceof Date ? m.exitDate : startOfToday();
        const shifts = await M("nursing", "roster").countDocuments({ staff: existing._id, status: "Scheduled", date: { $gt: exit } });
        if (shifts) reject("status", `${shifts} nursing duty shift(s) are rostered after the last working day. Reassign them first.`);
        const trip = await Trip.findOne({ status: { $in: [...ACTIVE_TRIP_STATUSES] }, $or: [{ driver: existing._id }, { "crew.staff": existing._id }] }).select("code").lean();
        if (trip) reject("status", `On active ambulance trip ${trip.code}`);
      }
    },
    beforeDelete: async (d) => {
      blockIfReferenced(await Attendance.countDocuments({ staff: d._id }), "attendance entr(ies)");
      blockIfReferenced(await PayrollRun.countDocuments({ "lines.staff": d._id }), "payroll run(s)");
      blockIfReferenced(await Trip.countDocuments({ $or: [{ driver: d._id }, { "crew.staff": d._id }] }), "ambulance trip(s)");
    },
  },

  "hr.leaves": {
    beforeSave: async (v, existing) => {
      const m = { ...(existing ?? {}), ...v } as RecordValues;
      if (!(m.fromDate instanceof Date) || !(m.toDate instanceof Date)) return;
      const from = m.fromDate;
      const to = m.toDate;
      const status = String(m.status);
      const staff = await staffDoc(m.staff, "staff");
      const datesChanged = !existing || ["staff", "fromDate", "toDate", "session", "leaveType"].some((k) => v[k] !== undefined && String(v[k]) !== String(existing[k]));
      if (datesChanged) v.days = await countLeaveDays(staff, from, to, String(m.session ?? "Full day"));
      const days = Number(v.days ?? m.days ?? 0);
      if (!existing && !WORKING_STATUSES.includes(String(staff.status))) reject("staff", `${staff.fullName} is ${String(staff.status).toLowerCase()}`);
      if (staff.joiningDate instanceof Date && from < staff.joiningDate) reject("fromDate", `${staff.fullName} joined on ${isoDate(staff.joiningDate)}`);

      const wasApproved = existing?.status === "Approved";
      // Approved leave feeds attendance and payroll, so its month must still be open.
      if ((status === "Approved" && (!wasApproved || datesChanged)) || (wasApproved && status !== "Approved")) await assertMonthOpen([from, to, ...(existing ? [existing.fromDate as Date] : [])], "leave in that month");
      if (status !== "Pending" && status !== "Approved") return;
      if (days <= 0) reject("toDate", "These dates are all holidays or weekly offs");

      const overlap = await M("hr", "leaves")
        .findOne({ staff: staff._id, status: { $in: ["Pending", "Approved"] }, fromDate: { $lte: to }, toDate: { $gte: from }, ...notSelf(existing) })
        .select("code session")
        .lean<Doc>();
      // Two half days on the same date (first and second half) may coexist.
      if (overlap && !(m.session !== "Full day" && overlap.session !== "Full day" && overlap.session !== m.session)) reject("fromDate", `Overlaps leave application ${overlap.code ?? ""}`);
      if (datesChanged || (status === "Approved" && !wasApproved)) await checkLeaveBalance(staff, String(m.leaveType), from, days, String(m.session ?? "Full day"), existing?._id);

      if (status === "Approved" && (!wasApproved || datesChanged)) {
        const shifts = await rosteredShifts(staff._id, from, to);
        if (shifts.length && m.session === "Full day") {
          reject("status", `${staff.fullName} has ${shifts.length} nursing duty shift(s) rostered in this period (${shifts.slice(0, 3).map((s) => `${isoDate(s.date)} ${s.shift}`).join(", ")}). Reassign them before approving.`);
        }
        const worked = await Attendance.findOne({ staff: staff._id, date: { $gte: from, $lte: to }, status: { $in: ["Present", "On Duty"] } }).select("date").lean();
        if (worked && m.session === "Full day") reject("status", `Attendance shows ${staff.fullName} present on ${isoDate(worked.date)}`);
        if (m.reliever) await assertAvailable(await staffDoc(m.reliever, "reliever"), from, "reliever");
      }
    },
  },

  "hr.advances": {
    beforeSave: async (v, existing) => {
      if (!existing) {
        Object.assign(v, { recovered: 0, balance: v.amount, status: "Active" });
        const s = await staffDoc(v.staff, "staff");
        if (!WORKING_STATUSES.includes(String(s.status))) reject("staff", `${s.fullName} is ${String(s.status).toLowerCase()}`);
        return;
      }
      const recovered = Number(existing.recovered ?? 0);
      if (recovered > 0 && v.staff !== undefined && String(v.staff) !== String(existing.staff)) reject("staff", "Recovery has started; the employee cannot change");
      const amount = Number(v.amount ?? existing.amount);
      if (amount < recovered) reject("amount", `₹${recovered} has already been recovered`);
      v.balance = Math.round((amount - recovered) * 100) / 100;
      v.status = v.balance > 0 ? "Active" : "Closed";
    },
    beforeDelete: async (d) => {
      if (Number(d.recovered ?? 0) > 0) throw new ApiError(409, "Recovery has started through payroll; this advance cannot be deleted.");
      blockIfReferenced(await PayrollRun.countDocuments({ "lines.recoveries.advance": d._id }), "payroll run(s)");
    },
  },

  "hr.shifts": {
    beforeSave: async (v) => {
      if (typeof v.code === "string") v.code = v.code.toUpperCase();
    },
  },

  "hr.holidays": {
    beforeSave: async (v, existing) => {
      if (v.date instanceof Date || existing) await assertMonthOpen([...(v.date instanceof Date ? [v.date] : []), ...(existing ? [existing.date as Date] : [])], "the holiday list for that month");
    },
    beforeDelete: async (d) => assertMonthOpen([d.date as Date], "the holiday list for that month"),
  },

  "nursing.roster": {
    beforeSave: async (v, existing) => {
      const m = { ...(existing ?? {}), ...v } as RecordValues;
      if (!m.staff || !(m.date instanceof Date)) return;
      const keyChanged = !existing || ["staff", "date", "shift", "status"].some((k) => v[k] !== undefined && String(v[k]) !== String(existing[k]));
      const staff = await staffDoc(m.staff, "staff");
      v.nurseName = String(staff.fullName);
      if (!keyChanged || m.status === "Absent") return;
      if (staff.staffCategory && staff.staffCategory !== "Nurse") reject("staff", `${staff.fullName} is not in the Nurse category`);
      if (m.status === "Scheduled" || m.status === "On Duty") await assertAvailable(staff, m.date, "staff");
      const clash = await M("nursing", "roster")
        .findOne({ staff: staff._id, date: m.date, shift: m.shift, status: { $ne: "Absent" }, ...notSelf(existing) })
        .select("ward")
        .lean<Doc>();
      if (clash) reject("shift", `${staff.fullName} is already rostered for the ${m.shift} shift on this day (${clash.ward})`);
    },
  },

  /* ---------- Insurance ---------- */

  "insurance.providers": {
    // Insurers recorded before types and status existed are treated as active insurance companies.
    beforeList: async () => {
      const P = M("insurance", "providers");
      await P.updateMany({ status: { $exists: false } }, { $set: { status: "Active" } });
      await P.updateMany({ payerType: { $exists: false } }, { $set: { payerType: "Insurance Company" } });
    },
    beforeDelete: async (d) => {
      blockIfReferenced(await Claim.countDocuments({ $or: [{ provider: d._id }, { tpa: d._id }] }), "insurance claim(s)");
      blockIfReferenced(await PreAuth.countDocuments({ $or: [{ insurer: d._id }, { tpa: d._id }] }), "pre-authorisation(s)");
      blockIfReferenced(await Bill.countDocuments({ insuranceProvider: d._id }), "hospital bill(s)");
    },
  },

  "insurance.policies": {
    beforeList: async () => {
      await M("insurance", "policies").updateMany({ status: "Active", validTo: { $lt: startOfToday() } }, { $set: { status: "Expired" } });
    },
    beforeSave: async (v, existing) => {
      const m = { ...(existing ?? {}), ...v } as RecordValues;
      const P = M("insurance", "providers");
      if (v.insurer) {
        const p = await P.findById(v.insurer).select("name payerType").lean<Doc>();
        if (p?.payerType === "TPA") reject("insurer", `${p.name} is a TPA; choose the insurance company`);
      }
      if (v.tpa) {
        const t = await P.findById(v.tpa).select("name payerType").lean<Doc>();
        if (t && t.payerType !== "TPA") reject("tpa", `${t.name} is not a TPA`);
      }
      if (typeof v.policyNumber === "string") v.policyNumber = v.policyNumber.toUpperCase();
      if (m.status === "Active" && m.validTo instanceof Date && m.validTo < startOfToday()) v.status = "Expired";
    },
    beforeDelete: async (d) => {
      blockIfReferenced(await PreAuth.countDocuments({ policy: d._id }), "pre-authorisation(s)");
      blockIfReferenced(await Claim.countDocuments({ policy: d._id }), "insurance claim(s)");
    },
  },

  /* ---------- Ambulance ---------- */

  "ambulance.vehicles": {
    beforeSave: async (v, existing) => {
      if (typeof v.vehicleNumber === "string") v.vehicleNumber = v.vehicleNumber.toUpperCase().replace(/\s+/g, " ");
      if (v.defaultDriver !== undefined) {
        const d = v.defaultDriver ? await staffDoc(v.defaultDriver, "defaultDriver") : null;
        if (d && d.staffCategory && d.staffCategory !== "Driver") reject("defaultDriver", `${d.fullName} is not in the Driver category`);
        v.driverName = d ? String(d.fullName) : null;
        v.driverPhone = d ? ((d.phone as string) ?? null) : null;
      }
      if (v.status === "On Trip" && existing?.status !== "On Trip") reject("status", "On Trip is set by dispatching the vehicle from the Dispatch Board");
      if (existing?.status === "On Trip" && v.status !== undefined && v.status !== "On Trip") {
        const trip = await Trip.findOne({ vehicle: existing._id, status: { $in: [...ACTIVE_TRIP_STATUSES] } }).select("code").lean();
        if (trip) reject("status", `The vehicle is on trip ${trip.code}. Complete or cancel it first.`);
      }
    },
    beforeDelete: async (d) => blockIfReferenced(await Trip.countDocuments({ vehicle: d._id }), "ambulance trip(s)"),
  },

  "ambulance.fuel": {
    beforeSave: async (v, existing) => {
      const m = { ...(existing ?? {}), ...v } as RecordValues;
      v.amount = Math.round(Number(m.litres) * Number(m.rate) * 100) / 100;
      if (!existing || v.odometer !== undefined || v.vehicle !== undefined) {
        const last = await M("ambulance", "fuel").findOne({ vehicle: m.vehicle, ...notSelf(existing), fillDate: { $lte: m.fillDate } }).sort({ fillDate: -1, odometer: -1 }).select("odometer fillDate").lean<Doc>();
        if (last && Number(m.odometer) < Number(last.odometer)) reject("odometer", `Below the previous fill-up reading (${last.odometer} km on ${isoDate(last.fillDate)})`);
      }
    },
    afterSave: async (doc) => {
      await M("ambulance", "vehicles").updateOne({ _id: doc.vehicle, $or: [{ odometer: { $lt: doc.odometer } }, { odometer: null }, { odometer: { $exists: false } }] }, { $set: { odometer: doc.odometer } });
    },
  },

  "ambulance.maintenance": {
    beforeSave: async (v, existing) => {
      const m = { ...(existing ?? {}), ...v } as RecordValues;
      const vehicle = await vehicleDoc(m.vehicle);
      if (existing && v.vehicle !== undefined && String(v.vehicle) !== String(existing.vehicle) && existing.status === "In Workshop") reject("vehicle", "Complete this job before moving it to another vehicle");
      if (m.status === "In Workshop" && existing?.status !== "In Workshop") {
        if (vehicle.status === "On Trip") reject("status", `${vehicle.vehicleNumber} is on a trip. Send it to the workshop after the trip.`);
        if (m.startDate instanceof Date && m.startDate > startOfToday()) reject("startDate", "A job cannot be in the workshop before it starts");
      }
      if (m.status === "Completed" && !(m.endDate instanceof Date)) v.endDate = startOfToday();
    },
    afterSave: async (doc, existing) => {
      const V = M("ambulance", "vehicles");
      if (doc.status === "In Workshop") await V.updateOne({ _id: doc.vehicle, status: { $in: ["Available", "Out of Service"] } }, { $set: { status: "Maintenance" } });
      else if (existing?.status === "In Workshop") await releaseFromWorkshop(existing.vehicle, doc._id);
      if (doc.status === "Completed") {
        const set: Record<string, unknown> = {};
        if (doc.nextServiceDue instanceof Date) set.nextServiceDue = doc.nextServiceDue;
        if (Object.keys(set).length) await V.updateOne({ _id: doc.vehicle }, { $set: set });
        if (typeof doc.odometerAtService === "number") await V.updateOne({ _id: doc.vehicle, $or: [{ odometer: { $lt: doc.odometerAtService } }, { odometer: null }] }, { $set: { odometer: doc.odometerAtService } });
      }
    },
    afterDelete: async (d) => {
      if (d.status === "In Workshop") await releaseFromWorkshop(d.vehicle, d._id);
    },
  },

  "marketing.leads": {
    beforeSave: async (v, existing) => {
      if (existing || typeof v.mobile !== "string") return;
      // One open lead per person: further enquiries are follow-ups on it.
      const open = await M("marketing", "leads").findOne({ mobile: v.mobile, status: { $nin: CLOSED_LEADS } }).select("code fullName").lean<Doc>();
      if (open) reject("mobile", `${open.fullName} already has an open lead (${open.code}). Add a follow-up to it instead.`);
    },
  },

  "marketing.followups": {
    afterSave: async (doc) => {
      const Leads = M("marketing", "leads");
      const lead = await Leads.findById(doc.lead).select("status").lean<Doc>();
      if (!lead) return;
      const set: Record<string, unknown> = { nextFollowUp: doc.nextFollowUp instanceof Date ? doc.nextFollowUp : null };
      const current = String(lead.status);
      // Converted and lost leads keep their status; "Converted" itself needs the patient linked on the lead.
      if (!["Converted", "Lost"].includes(current)) {
        const next = FOLLOWUP_STATUS[String(doc.outcome)];
        if (next && !(next === "Contacted" && current !== "New")) set.status = next;
      }
      await Leads.updateOne({ _id: lead._id }, { $set: set });
    },
  },

  ...ACCOUNTS_RULES,
};
