import "server-only";
import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { PAYMENT_MODES, RATE_PLANS } from "@/lib/modules";
import { modelName } from "./records";

/**
 * One lab registration (Lab No.). Tests, their samples, results, payments and
 * report sharing all live on the order so every step is a single atomic write.
 */

export const ITEM_STATUSES = [
  "Ordered", // waiting for the sample
  "Sample Collected",
  "Sample Received",
  "In Process",
  "Sent Out",
  "Result Entered",
  "Verified",
  "Approved",
  "Cancelled",
] as const;
export const SAMPLE_STATUSES = ["Pending", "Collected", "Received", "Rejected"] as const;
export const ORDER_STATUSES = ["Registered", "Sample Collected", "In Process", "Partially Reported", "Reported", "Cancelled"] as const;
export const LAB_PAYMENT_STATUSES = ["Unpaid", "Partially Paid", "Paid", "Refund Due", "Cancelled"] as const;
export const ORDER_SOURCES = ["OPD", "IPD", "Walk-in"] as const;
export const PRIORITIES = ["Routine", "Urgent", "STAT"] as const;
export const FLAGS = ["", "L", "H", "LL", "HH", "A"] as const;
export const REJECT_REASONS = ["Haemolysed", "Clotted", "Insufficient quantity", "Wrong container", "Unlabelled / mislabelled", "Leaked / broken", "Delayed transport", "Other"] as const;

const ResultSchema = new Schema(
  {
    parameter: { type: Schema.Types.ObjectId, ref: modelName("laboratory", "parameters") },
    name: { type: String, required: true },
    unit: String,
    resultType: { type: String, enum: ["Numeric", "Text", "Options"], default: "Numeric" },
    options: String,
    normalValue: String,
    decimals: Number,
    value: String,
    numeric: Number,
    low: Number,
    high: Number,
    criticalLow: Number,
    criticalHigh: Number,
    rangeText: String,
    flag: { type: String, enum: FLAGS, default: "" },
    sortOrder: { type: Number, default: 10 },
  },
  { _id: false }
);

const ItemSchema = new Schema({
  test: { type: Schema.Types.ObjectId, ref: modelName("laboratory", "tests"), required: true },
  testName: { type: String, required: true },
  testCode: String,
  category: { type: Schema.Types.ObjectId, ref: modelName("laboratory", "categories") },
  categoryName: String,
  categoryOrder: { type: Number, default: 10 },
  method: String,
  sampleType: String,
  container: String,
  reportType: { type: String, enum: ["Parametric", "Descriptive"], default: "Parametric" },
  profile: { type: Schema.Types.ObjectId, ref: modelName("laboratory", "profiles") },
  profileName: String,
  price: { type: Number, required: true, min: 0 },
  sampleNo: String,
  status: { type: String, enum: ITEM_STATUSES, default: "Ordered" },
  outsourceLab: { type: Schema.Types.ObjectId, ref: modelName("laboratory", "outsource_labs") },
  outsourceLabName: String,
  outsourceRef: String,
  sentOutAt: Date,
  receivedBackAt: Date,
  processingAt: Date,
  processingByName: String,
  results: { type: [ResultSchema], default: [] },
  reportText: String,
  remarks: String,
  abnormal: { type: Boolean, default: false },
  critical: { type: Boolean, default: false },
  enteredAt: Date,
  enteredBy: { type: Schema.Types.ObjectId, ref: "User" },
  enteredByName: String,
  verifiedAt: Date,
  verifiedBy: { type: Schema.Types.ObjectId, ref: "User" },
  verifiedByName: String,
  approvedAt: Date,
  approvedBy: { type: Schema.Types.ObjectId, ref: "User" },
  approvedByName: String,
  pathologist: { type: Schema.Types.ObjectId, ref: modelName("doctors", "doctors") },
  pathologistName: String,
  pathologistQualification: String,
  pathologistRegNo: String,
  cancelledAt: Date,
  cancelReason: String,
  cancelledByName: String,
});

const SampleSchema = new Schema({
  accessionNo: { type: String, required: true },
  sampleType: String,
  container: String,
  status: { type: String, enum: SAMPLE_STATUSES, default: "Pending" },
  collectedAt: Date,
  collectedByName: String,
  receivedAt: Date,
  receivedByName: String,
  rejectedAt: Date,
  rejectedByName: String,
  rejectReason: String,
  recollectOf: String,
  replacedBy: String,
});

const PaymentSchema = new Schema(
  {
    kind: { type: String, enum: ["Payment", "Refund"], default: "Payment" },
    amount: { type: Number, required: true, min: 0 },
    mode: { type: String, enum: PAYMENT_MODES, required: true },
    reference: String,
    at: { type: Date, default: () => new Date() },
    byName: String,
  },
  { _id: false }
);

const ShareSchema = new Schema(
  {
    to: { type: String, enum: ["Patient", "Doctor"], required: true },
    channel: { type: String, enum: ["Link", "WhatsApp", "Email", "SMS"], required: true },
    recipient: String,
    at: { type: Date, default: () => new Date() },
    byName: String,
  },
  { _id: false }
);

const LabOrderSchema = new Schema(
  {
    code: { type: String, required: true, unique: true },
    orderDate: { type: Date, required: true },
    patient: { type: Schema.Types.ObjectId, ref: modelName("patients", "patients"), required: true },
    patientName: { type: String, required: true },
    patientCode: String,
    patientGender: String,
    patientAge: Number,
    patientDob: Date,
    patientMobile: String,
    source: { type: String, enum: ORDER_SOURCES, required: true },
    visit: { type: Schema.Types.ObjectId, ref: modelName("opd_ipd", "visits") },
    visitCode: String,
    admission: { type: Schema.Types.ObjectId, ref: modelName("opd_ipd", "admissions") },
    admissionCode: String,
    wardBed: String,
    doctor: { type: Schema.Types.ObjectId, ref: modelName("doctors", "doctors") },
    doctorName: String,
    doctorPhone: String,
    doctorEmail: String,
    priority: { type: String, enum: PRIORITIES, default: "Routine" },
    ratePlan: { type: String, enum: RATE_PLANS, default: "General" },
    clinicalNotes: String,
    items: { type: [ItemSchema], validate: (v: unknown[]) => v.length > 0 },
    samples: { type: [SampleSchema], default: [] },
    grossAmount: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    netAmount: { type: Number, default: 0 },
    paidAmount: { type: Number, default: 0 },
    payments: { type: [PaymentSchema], default: [] },
    paymentStatus: { type: String, enum: LAB_PAYMENT_STATUSES, default: "Unpaid" },
    status: { type: String, enum: ORDER_STATUSES, default: "Registered" },
    reportedAt: Date,
    shareToken: String,
    shareExpiresAt: Date,
    shares: { type: [ShareSchema], default: [] },
    cancelledAt: Date,
    cancelReason: String,
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    createdByName: String,
  },
  { timestamps: true, collection: "lab_orders" }
);
LabOrderSchema.index({ orderDate: -1 });
LabOrderSchema.index({ patient: 1, orderDate: -1 });
LabOrderSchema.index({ status: 1, orderDate: -1 });
LabOrderSchema.index({ "samples.accessionNo": 1 });
LabOrderSchema.index({ "items.test": 1 });
LabOrderSchema.index({ shareToken: 1 }, { unique: true, sparse: true });

export type LabOrderDoc = InferSchemaType<typeof LabOrderSchema> & { _id: mongoose.Types.ObjectId };
export const LabOrder: Model<InferSchemaType<typeof LabOrderSchema>> = mongoose.models.LabOrder ?? mongoose.model("LabOrder", LabOrderSchema);
