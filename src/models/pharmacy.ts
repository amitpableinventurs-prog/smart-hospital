import "server-only";
import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { PAYMENT_MODES } from "@/lib/modules";
import { modelName } from "./records";

const ITEM = modelName("inventory", "items");
const BATCH = modelName("inventory", "batches");

/* ---------- Sale bill (stock out) ---------- */

const SaleLineSchema = new Schema(
  {
    item: { type: Schema.Types.ObjectId, ref: ITEM, required: true },
    itemName: { type: String, required: true },
    hsnCode: String,
    batch: { type: Schema.Types.ObjectId, ref: BATCH, required: true },
    batchNo: { type: String, required: true },
    expiryDate: Date,
    qty: { type: Number, required: true, min: 1 },
    mrp: { type: Number, required: true, min: 0 },
    discountPct: { type: Number, default: 0, min: 0, max: 100 },
    gstRate: { type: Number, required: true, min: 0 },
    gross: Number,
    discount: Number,
    taxable: Number,
    gst: Number,
    amount: Number,
  },
  { _id: false }
);

/** Payments received after the bill was made (credit bills); the amount paid at billing is not listed here. */
const SalePaymentSchema = new Schema(
  {
    amount: { type: Number, required: true, min: 0.01 },
    mode: { type: String, enum: PAYMENT_MODES, required: true },
    reference: String,
    at: { type: Date, default: () => new Date() },
    byName: String,
  },
  { _id: false }
);

const SaleSchema = new Schema(
  {
    code: { type: String, required: true, unique: true },
    billDate: { type: Date, required: true },
    patient: { type: Schema.Types.ObjectId, ref: modelName("patients", "patients") },
    customerName: { type: String, required: true, trim: true, maxlength: 120 },
    customerPhone: { type: String, trim: true, maxlength: 20 },
    doctor: { type: Schema.Types.ObjectId, ref: modelName("doctors", "doctors") },
    doctorName: String,
    paymentMode: { type: String, enum: PAYMENT_MODES, required: true },
    items: { type: [SaleLineSchema], validate: (v: unknown[]) => v.length > 0 },
    grossTotal: Number,
    discountTotal: Number,
    taxableTotal: Number,
    gstTotal: Number,
    roundOff: Number,
    netAmount: { type: Number, required: true },
    paidAmount: { type: Number, default: 0 },
    payments: { type: [SalePaymentSchema], default: [] },
    status: { type: String, enum: ["Paid", "Partially Paid", "Unpaid", "Cancelled"], required: true },
    notes: String,
    cancelledAt: Date,
    cancelReason: String,
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    createdByName: String,
  },
  { timestamps: true, collection: "pharmacy_sales" }
);
SaleSchema.index({ billDate: -1 });
SaleSchema.index({ patient: 1, billDate: -1 });
SaleSchema.index({ "items.item": 1 });

export type SaleDoc = InferSchemaType<typeof SaleSchema> & { _id: mongoose.Types.ObjectId };
export const Sale: Model<InferSchemaType<typeof SaleSchema>> = mongoose.models.PharmacySale ?? mongoose.model("PharmacySale", SaleSchema);

/* ---------- Purchase entry (stock in) ---------- */

const PurchaseLineSchema = new Schema(
  {
    item: { type: Schema.Types.ObjectId, ref: ITEM, required: true },
    itemName: { type: String, required: true },
    batch: { type: Schema.Types.ObjectId, ref: BATCH },
    batchNo: { type: String, required: true },
    expiryDate: Date,
    qty: { type: Number, required: true, min: 1 },
    freeQty: { type: Number, default: 0, min: 0 },
    purchaseRate: { type: Number, required: true, min: 0 },
    mrp: { type: Number, required: true, min: 0 },
    discountPct: { type: Number, default: 0, min: 0, max: 100 },
    gstRate: { type: Number, required: true, min: 0 },
    taxable: Number,
    gst: Number,
    amount: Number,
  },
  { _id: false }
);

const PurchaseSchema = new Schema(
  {
    code: { type: String, required: true, unique: true },
    supplier: { type: Schema.Types.ObjectId, ref: modelName("inventory", "suppliers"), required: true },
    supplierName: String,
    supplierInvoiceNo: { type: String, required: true, trim: true, maxlength: 40 },
    invoiceDate: { type: Date, required: true },
    items: { type: [PurchaseLineSchema], validate: (v: unknown[]) => v.length > 0 },
    taxableTotal: Number,
    gstTotal: Number,
    roundOff: Number,
    netAmount: { type: Number, required: true },
    status: { type: String, enum: ["Received", "Cancelled"], default: "Received" },
    notes: String,
    cancelledAt: Date,
    cancelReason: String,
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    createdByName: String,
  },
  { timestamps: true, collection: "pharmacy_purchases" }
);
PurchaseSchema.index({ invoiceDate: -1 });
PurchaseSchema.index({ supplier: 1, supplierInvoiceNo: 1 });
PurchaseSchema.index({ "items.item": 1 });

export type PurchaseDoc = InferSchemaType<typeof PurchaseSchema> & { _id: mongoose.Types.ObjectId };
export const Purchase: Model<InferSchemaType<typeof PurchaseSchema>> =
  mongoose.models.PharmacyPurchase ?? mongoose.model("PharmacyPurchase", PurchaseSchema);
