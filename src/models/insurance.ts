import "server-only";
import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { modelName } from "./records";

/**
 * Cashless pre-authorisations and insurance claims. Queries, enhancements,
 * documents and settlements live on the document so each step is one atomic write.
 */

export const PREAUTH_STATUSES = ["Draft", "Submitted", "Query Raised", "Approved", "Enhancement Requested", "Rejected", "Cancelled", "Claimed"] as const;
export const TREATMENT_TYPES = ["Medical Management", "Surgical", "Day Care", "Maternity", "ICU / Critical Care"] as const;
export const ROOM_CATEGORIES = ["General Ward", "Semi-Private", "Private", "Deluxe", "ICU"] as const;
/** Earlier claims (created before the bespoke workflow) used Submitted … Settled, which are kept. */
export const CLAIM_STATUSES = ["Pending Submission", "Submitted", "Under Review", "Query Raised", "Approved", "Partially Settled", "Settled", "Rejected", "Cancelled"] as const;
export const CLAIM_TYPES = ["Cashless", "Reimbursement"] as const;
export const CLAIM_DOCUMENTS = [
  "Claim form (signed)",
  "Pre-authorisation approval letter",
  "Final bill with break-up",
  "Discharge summary",
  "Investigation reports",
  "Pharmacy bills",
  "Patient ID & policy / e-card copy",
  "Doctor's prescription / case papers",
  "Implant stickers & invoice",
  "Cancelled cheque / NEFT details",
] as const;
/** Documents every claim needs; the rest are added as applicable. */
export const REQUIRED_DOCUMENTS = new Set<string>(["Claim form (signed)", "Final bill with break-up", "Discharge summary", "Investigation reports", "Patient ID & policy / e-card copy"]);

const EventSchema = new Schema({ at: { type: Date, default: () => new Date() }, action: String, byName: String, note: String }, { _id: false });

const QuerySchema = new Schema({
  raisedAt: { type: Date, required: true },
  query: { type: String, required: true },
  raisedByName: String,
  response: String,
  respondedAt: Date,
  respondedByName: String,
});

const EnhancementSchema = new Schema({
  requestedAmount: { type: Number, required: true, min: 0 },
  reason: String,
  requestedAt: { type: Date, default: () => new Date() },
  requestedByName: String,
  status: { type: String, enum: ["Pending", "Approved", "Rejected"], default: "Pending" },
  approvedAmount: Number,
  decidedAt: Date,
  decidedByName: String,
  remarks: String,
});

const PreAuthSchema = new Schema(
  {
    code: { type: String, required: true, unique: true },
    patient: { type: Schema.Types.ObjectId, ref: modelName("patients", "patients"), required: true },
    patientName: { type: String, required: true },
    patientCode: String,
    patientAge: Number,
    patientGender: String,
    patientMobile: String,

    policy: { type: Schema.Types.ObjectId, ref: modelName("insurance", "policies"), required: true },
    insurer: { type: Schema.Types.ObjectId, ref: modelName("insurance", "providers"), required: true },
    insurerName: String,
    tpa: { type: Schema.Types.ObjectId, ref: modelName("insurance", "providers") },
    tpaName: String,
    policyNumber: String,
    memberId: String,
    sumInsured: Number,
    copayPct: Number,

    admission: { type: Schema.Types.ObjectId, ref: modelName("opd_ipd", "admissions") },
    admissionCode: String,
    admissionDate: Date,
    plannedAdmissionDate: Date,
    doctor: { type: Schema.Types.ObjectId, ref: modelName("doctors", "doctors") },
    doctorName: String,
    department: String,
    diagnosis: { type: String, required: true },
    icdCode: String,
    treatmentType: { type: String, enum: TREATMENT_TYPES },
    procedure: String,
    expectedStayDays: Number,
    roomCategory: { type: String, enum: ROOM_CATEGORIES },
    estimatedAmount: { type: Number, required: true, min: 0 },
    requestedAmount: { type: Number, required: true, min: 0 },

    /** Total sanctioned so far (initial approval plus approved enhancements). */
    approvedAmount: { type: Number, default: 0 },
    authNo: String,
    submittedAt: Date,
    approvedAt: Date,
    decisionAt: Date,
    rejectReason: String,
    cancelReason: String,
    queries: { type: [QuerySchema], default: [] },
    enhancements: { type: [EnhancementSchema], default: [] },

    bill: { type: Schema.Types.ObjectId, ref: "HospitalBill" },
    billCode: String,
    billSyncedAt: Date,
    claim: { type: Schema.Types.ObjectId, ref: modelName("insurance", "claims") },
    claimCode: String,

    status: { type: String, enum: PREAUTH_STATUSES, default: "Draft" },
    events: { type: [EventSchema], default: [] },
    notes: String,
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    createdByName: String,
  },
  { timestamps: true, collection: "insurance_preauths", optimisticConcurrency: true }
);
PreAuthSchema.index({ createdAt: -1 });
PreAuthSchema.index({ patient: 1, createdAt: -1 });
PreAuthSchema.index({ admission: 1 });
PreAuthSchema.index({ status: 1 });

export type PreAuthDoc = InferSchemaType<typeof PreAuthSchema> & { _id: mongoose.Types.ObjectId };
export const PreAuth: Model<InferSchemaType<typeof PreAuthSchema>> = mongoose.models.InsurancePreAuth ?? mongoose.model("InsurancePreAuth", PreAuthSchema);

/* ---------- Claims ---------- */

const DocumentSchema = new Schema({ name: { type: String, required: true }, required: Boolean, received: { type: Boolean, default: false }, receivedAt: Date, byName: String }, { _id: false });

const SettlementSchema = new Schema({
  at: { type: Date, required: true },
  amount: { type: Number, default: 0, min: 0 },
  tds: { type: Number, default: 0, min: 0 },
  deduction: { type: Number, default: 0, min: 0 },
  toPatient: { type: Number, default: 0, min: 0 },
  mode: String,
  utr: String,
  reason: String,
  receiptCode: String,
  byName: String,
});

const ClaimSchema = new Schema(
  {
    code: { type: String, required: true, unique: true },
    claimType: { type: String, enum: CLAIM_TYPES, default: "Cashless" },
    patient: { type: Schema.Types.ObjectId, ref: modelName("patients", "patients"), required: true },
    patientName: String,
    patientCode: String,
    /** The insurer (kept as `provider` for claims recorded before this workflow). */
    provider: { type: Schema.Types.ObjectId, ref: modelName("insurance", "providers"), required: true },
    providerName: String,
    tpa: { type: Schema.Types.ObjectId, ref: modelName("insurance", "providers") },
    tpaName: String,
    policy: { type: Schema.Types.ObjectId, ref: modelName("insurance", "policies") },
    policyNumber: { type: String, required: true },
    memberId: String,
    preauth: { type: Schema.Types.ObjectId, ref: "InsurancePreAuth" },
    preauthCode: String,
    authNo: String,
    bill: { type: Schema.Types.ObjectId, ref: "HospitalBill" },
    billCode: String,
    billDate: Date,
    admissionCode: String,
    admissionDate: Date,
    dischargeDate: Date,
    diagnosis: String,

    claimAmount: { type: Number, required: true, min: 0 },
    approvedAmount: Number,
    settledAmount: { type: Number, default: 0 },
    tdsAmount: { type: Number, default: 0 },
    deductionAmount: { type: Number, default: 0 },
    patientAmount: { type: Number, default: 0 },
    outstanding: { type: Number, default: 0 },

    submittedDate: Date,
    dueDate: Date,
    settledDate: Date,
    documents: { type: [DocumentSchema], default: [] },
    queries: { type: [QuerySchema], default: [] },
    settlements: { type: [SettlementSchema], default: [] },
    status: { type: String, enum: CLAIM_STATUSES, default: "Pending Submission" },
    rejectReason: String,
    remarks: String,
    events: { type: [EventSchema], default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
    createdByName: String,
  },
  { timestamps: true, collection: "insurance_claims", optimisticConcurrency: true }
);
ClaimSchema.index({ createdAt: -1 });
ClaimSchema.index({ patient: 1, createdAt: -1 });
ClaimSchema.index({ provider: 1, status: 1 });
ClaimSchema.index({ bill: 1 });
ClaimSchema.index({ status: 1, submittedDate: 1 });

export type ClaimDoc = InferSchemaType<typeof ClaimSchema> & { _id: mongoose.Types.ObjectId };
// Registered under the registry's old model name so existing refs (e.g. bills) still resolve.
export const Claim: Model<InferSchemaType<typeof ClaimSchema>> = mongoose.models[modelName("insurance", "claims")] ?? mongoose.model(modelName("insurance", "claims"), ClaimSchema);
