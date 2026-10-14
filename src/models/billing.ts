import "server-only";
import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { BILL_PAYMENT_MODES, BILL_TYPES, PAYER_TYPES, RATE_PLANS, SERVICE_CATEGORIES } from "@/lib/modules";
import { modelName } from "./records";

/**
 * One hospital bill (an OPD visit, an IPD stay, an emergency episode…).
 * Charges and every receipt against the bill live on the document, so totals,
 * dues and status are always re-derived from them in a single atomic write.
 */

export const LINE_KINDS = ["Service", "Package", "Doctor Fee", "Inventory", "Ambulance", "Manual"] as const;
export const BILL_STATUSES = ["Provisional", "Final", "Closed", "Cancelled"] as const;
export const BILL_PAYMENT_STATUSES = ["Unpaid", "Partially Paid", "Paid", "Advance", "Refund Due", "Cancelled"] as const;
/** Advance & Payment come from the patient, Refund goes back to them, Settlement comes from the corporate / insurer. */
export const RECEIPT_KINDS = ["Advance", "Payment", "Refund", "Settlement"] as const;
export const RECON_STATUSES = ["Not Required", "Pending", "Reconciled", "Bounced"] as const;

const LineSchema = new Schema({
  kind: { type: String, enum: LINE_KINDS, required: true },
  category: { type: String, enum: SERVICE_CATEGORIES, required: true },
  service: { type: Schema.Types.ObjectId, ref: modelName("billing", "services") },
  package: { type: Schema.Types.ObjectId, ref: modelName("billing", "packages") },
  doctor: { type: Schema.Types.ObjectId, ref: modelName("doctors", "doctors") },
  doctorName: String,
  feeType: String,
  /** Doctor's share (%) at the time of billing, for doctor payouts. */
  doctorSharePct: Number,
  name: { type: String, required: true },
  code: String,
  detail: String,
  unit: String,
  serviceDate: Date,
  qty: { type: Number, required: true, min: 0.01 },
  rate: { type: Number, required: true, min: 0 },
  rateEditable: Boolean,
  rateOverridden: Boolean,
  discountPct: { type: Number, default: 0, min: 0, max: 100 },
  gstRate: { type: Number, default: 0, min: 0 },
  gross: { type: Number, default: 0 },
  discount: { type: Number, default: 0 },
  taxable: { type: Number, default: 0 },
  gst: { type: Number, default: 0 },
  amount: { type: Number, default: 0 },
  /** Charges posted by another workflow (e.g. an inventory patient issue). */
  sourceId: Schema.Types.ObjectId,
  sourceLine: Schema.Types.ObjectId,
  sourceCode: String,
  status: { type: String, enum: ["Active", "Cancelled"], default: "Active" },
  cancelledAt: Date,
  cancelReason: String,
  cancelledByName: String,
  addedAt: { type: Date, default: () => new Date() },
  addedByName: String,
});

const SplitSchema = new Schema({
  mode: { type: String, enum: BILL_PAYMENT_MODES, required: true },
  amount: { type: Number, required: true, min: 0.01 },
  reference: String,
  /** Non-cash money is reconciled against the bank / card settlement; bounced money no longer counts. */
  recon: { type: String, enum: RECON_STATUSES, default: "Not Required" },
  reconAt: Date,
  reconByName: String,
  reconNote: String,
});

const ReceiptSchema = new Schema({
  code: { type: String, required: true },
  kind: { type: String, enum: RECEIPT_KINDS, required: true },
  amount: { type: Number, required: true, min: 0 },
  splits: { type: [SplitSchema], default: [] },
  /** Settlements: amount the payer deducted that the hospital writes off… */
  writeOff: { type: Number, default: 0 },
  /** …and amount the payer disallowed that moves to the patient. */
  toPatient: { type: Number, default: 0 },
  reason: String,
  approvedBy: String,
  at: { type: Date, default: () => new Date() },
  by: { type: Schema.Types.ObjectId, ref: "User" },
  byName: String,
  shift: { type: Schema.Types.ObjectId, ref: "BillingShift" },
  shiftCode: String,
});

const BillSchema = new Schema(
  {
    code: { type: String, required: true, unique: true },
    billDate: { type: Date, required: true },
    billType: { type: String, enum: BILL_TYPES, required: true },
    patient: { type: Schema.Types.ObjectId, ref: modelName("patients", "patients"), required: true },
    patientName: { type: String, required: true },
    patientCode: String,
    patientAge: Number,
    patientGender: String,
    patientMobile: String,
    visit: { type: Schema.Types.ObjectId, ref: modelName("opd_ipd", "visits") },
    visitCode: String,
    admission: { type: Schema.Types.ObjectId, ref: modelName("opd_ipd", "admissions") },
    admissionCode: String,
    admissionDate: Date,
    wardBed: String,
    dischargeDate: Date,
    doctor: { type: Schema.Types.ObjectId, ref: modelName("doctors", "doctors") },
    doctorName: String,
    department: String,
    ratePlan: { type: String, enum: RATE_PLANS, default: "General" },

    payerType: { type: String, enum: PAYER_TYPES, default: "Self" },
    corporate: { type: Schema.Types.ObjectId, ref: modelName("billing", "corporates") },
    insuranceProvider: { type: Schema.Types.ObjectId, ref: modelName("insurance", "providers") },
    payerName: String,
    tpaName: String,
    policyNo: String,
    authNo: String,
    /** Approved / sanctioned amount; the payer never covers more than this. */
    payerLimit: Number,
    coveragePct: Number,
    creditDays: Number,

    lines: { type: [LineSchema], default: [] },
    grossAmount: { type: Number, default: 0 },
    lineDiscount: { type: Number, default: 0 },
    billDiscount: { type: Number, default: 0 },
    discountAmount: { type: Number, default: 0 },
    discountReason: String,
    discountApprovedBy: String,
    taxableAmount: { type: Number, default: 0 },
    gstAmount: { type: Number, default: 0 },
    roundOff: { type: Number, default: 0 },
    netAmount: { type: Number, default: 0 },

    payerShare: { type: Number, default: 0 },
    patientShare: { type: Number, default: 0 },
    movedToPatient: { type: Number, default: 0 },
    patientPaid: { type: Number, default: 0 },
    payerPaid: { type: Number, default: 0 },
    payerWriteOff: { type: Number, default: 0 },
    patientDue: { type: Number, default: 0 },
    payerDue: { type: Number, default: 0 },
    refundDue: { type: Number, default: 0 },
    receipts: { type: [ReceiptSchema], default: [] },

    status: { type: String, enum: BILL_STATUSES, default: "Provisional" },
    paymentStatus: { type: String, enum: BILL_PAYMENT_STATUSES, default: "Unpaid" },
    finalizedAt: Date,
    finalizedByName: String,
    claim: { type: Schema.Types.ObjectId, ref: modelName("insurance", "claims") },
    claimCode: String,
    cancelledAt: Date,
    cancelReason: String,
    cancelledByName: String,
    notes: String,
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    createdByName: String,
  },
  { timestamps: true, collection: "billing_bills", optimisticConcurrency: true }
);
BillSchema.index({ billDate: -1 });
BillSchema.index({ patient: 1, billDate: -1 });
BillSchema.index({ admission: 1, status: 1 });
BillSchema.index({ status: 1, billDate: -1 });
BillSchema.index({ patientDue: 1 });
BillSchema.index({ payerType: 1, payerDue: 1 });
BillSchema.index({ "receipts.at": -1 });
BillSchema.index({ "receipts.code": 1 });
BillSchema.index({ "receipts.shift": 1 });
BillSchema.index({ "lines.sourceId": 1 });
BillSchema.index({ "lines.service": 1 });
BillSchema.index({ "lines.doctor": 1 });

export type BillDoc = InferSchemaType<typeof BillSchema> & { _id: mongoose.Types.ObjectId };
export const Bill: Model<InferSchemaType<typeof BillSchema>> = mongoose.models.HospitalBill ?? mongoose.model("HospitalBill", BillSchema);

/* ---------- Cashier shift (cash counter session) ---------- */

const ShiftSchema = new Schema(
  {
    code: { type: String, required: true, unique: true },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    userName: String,
    counter: { type: String, required: true },
    openedAt: { type: Date, required: true },
    openingCash: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: ["Open", "Closed"], default: "Open" },
    closedAt: Date,
    closedByName: String,
    expectedCash: Number,
    countedCash: Number,
    difference: Number,
    /** Totals by mode, frozen when the shift is closed. */
    summary: Schema.Types.Mixed,
    handoverTo: String,
    notes: String,
  },
  { timestamps: true, collection: "billing_shifts" }
);
ShiftSchema.index({ user: 1 }, { unique: true, partialFilterExpression: { status: "Open" } });
ShiftSchema.index({ openedAt: -1 });

export type ShiftDoc = InferSchemaType<typeof ShiftSchema> & { _id: mongoose.Types.ObjectId };
export const Shift: Model<InferSchemaType<typeof ShiftSchema>> = mongoose.models.BillingShift ?? mongoose.model("BillingShift", ShiftSchema);

/* ---------- Daily cash closing ---------- */

const DayCloseSchema = new Schema(
  {
    date: { type: Date, required: true, unique: true },
    summary: Schema.Types.Mixed,
    cashDeposited: Number,
    depositReference: String,
    notes: String,
    closedBy: { type: Schema.Types.ObjectId, ref: "User" },
    closedByName: String,
    closedAt: { type: Date, default: () => new Date() },
  },
  { collection: "billing_day_closes" }
);

export const DayClose: Model<InferSchemaType<typeof DayCloseSchema>> = mongoose.models.BillingDayClose ?? mongoose.model("BillingDayClose", DayCloseSchema);
