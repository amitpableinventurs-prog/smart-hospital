import "server-only";
import type { Types } from "mongoose";
import { ApiError, escapeRegex } from "./api";
import type { RecordValues } from "./modules";
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

function blockIfReferenced(count: number, what: string) {
  if (count > 0) throw new ApiError(409, `Cannot delete: ${count} ${what} still reference this record.`);
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
    beforeDelete: async (d) => blockIfReferenced(await Sale.countDocuments({ patient: d._id }), "pharmacy bill(s)"),
  },

  "doctors.doctors": {
    beforeDelete: async (d) => blockIfReferenced(await Sale.countDocuments({ doctor: d._id }), "pharmacy bill(s)"),
  },

  "inventory.items": {
    beforeDelete: async (d) => {
      blockIfReferenced(await Purchase.countDocuments({ "items.item": d._id }), "purchase entr(ies)");
      blockIfReferenced(await Sale.countDocuments({ "items.item": d._id }), "sale bill(s)");
    },
  },

  "inventory.suppliers": {
    beforeDelete: async (d) => blockIfReferenced(await Purchase.countDocuments({ supplier: d._id }), "purchase entr(ies)"),
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
};
