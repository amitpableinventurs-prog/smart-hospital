import "server-only";
import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { DOC_TYPES } from "@/lib/inventory-docs";
import { modelName } from "./records";

const ITEM = modelName("inventory", "items");
const BATCH = modelName("inventory", "batches");
const STORE = modelName("inventory", "stores");

/**
 * Every inventory workflow (requisition, PO, GRN, issue, transfer, return,
 * write-off, adjustment, verification, reservation…) is a stock document with
 * lines. Posting a document moves batch stock and writes the stock ledger.
 */

const LineSchema = new Schema({
  item: { type: Schema.Types.ObjectId, ref: ITEM, required: true },
  itemName: { type: String, required: true },
  sku: String,
  unit: String,
  purchaseUnit: String,
  conversion: { type: Number, default: 1 },
  batch: { type: Schema.Types.ObjectId, ref: BATCH },
  batchNo: String,
  expiryDate: Date,
  /** Signed only for stock adjustments. */
  qty: { type: Number, required: true },
  freeQty: { type: Number, default: 0 },
  /** PO lines: quantity received so far (purchase units). */
  receivedQty: { type: Number, default: 0 },
  /** Lines that can be returned (issues, transfers, GRNs): quantity returned so far. */
  returnedQty: { type: Number, default: 0 },
  rate: { type: Number, default: 0 },
  mrp: Number,
  discountPct: { type: Number, default: 0 },
  gstRate: { type: Number, default: 0 },
  taxable: Number,
  gst: Number,
  amount: Number,
  /** Physical verification. */
  systemQty: Number,
  countedQty: Number,
  /** Source line for returns (against another document). */
  sourceLine: Schema.Types.ObjectId,
  remarks: String,
});

const StockDocSchema = new Schema(
  {
    type: { type: String, enum: DOC_TYPES, required: true },
    code: { type: String, required: true, unique: true },
    docDate: { type: Date, required: true },
    status: { type: String, required: true },
    store: { type: Schema.Types.ObjectId, ref: STORE },
    storeName: String,
    toStore: { type: Schema.Types.ObjectId, ref: STORE },
    toStoreName: String,
    department: String,
    supplier: { type: Schema.Types.ObjectId, ref: modelName("inventory", "suppliers") },
    supplierName: String,
    patient: { type: Schema.Types.ObjectId, ref: modelName("patients", "patients") },
    patientName: String,
    patientCode: String,
    admission: { type: Schema.Types.ObjectId, ref: modelName("opd_ipd", "admissions") },
    admissionCode: String,
    /** Linked documents: PO → requisition, GRN → PO, return → source document, issue → reservation. */
    requisition: { type: Schema.Types.ObjectId, ref: "StockDoc" },
    requisitionCode: String,
    po: { type: Schema.Types.ObjectId, ref: "StockDoc" },
    poCode: String,
    against: { type: Schema.Types.ObjectId, ref: "StockDoc" },
    againstCode: String,
    againstType: String,
    reservation: { type: Schema.Types.ObjectId, ref: "StockDoc" },
    reservationCode: String,
    purpose: String,
    reason: String,
    priority: String,
    invoiceNo: String,
    invoiceDate: Date,
    dueDate: Date,
    requiredBy: Date,
    expectedDate: Date,
    terms: String,
    notes: String,
    lines: { type: [LineSchema], default: [] },
    taxableTotal: { type: Number, default: 0 },
    gstTotal: { type: Number, default: 0 },
    discountTotal: { type: Number, default: 0 },
    roundOff: { type: Number, default: 0 },
    netAmount: { type: Number, default: 0 },
    /** Value of the movement at cost (issues, write-offs, adjustments…). */
    costValue: { type: Number, default: 0 },
    chargeToPatient: Boolean,
    billingInvoice: { type: Schema.Types.ObjectId, ref: modelName("billing", "invoices") },
    billingInvoiceCode: String,
    approvedAt: Date,
    approvedByName: String,
    postedAt: Date,
    postedByName: String,
    cancelledAt: Date,
    cancelReason: String,
    cancelledByName: String,
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    createdByName: String,
  },
  { timestamps: true, collection: "inventory_docs", optimisticConcurrency: true }
);
StockDocSchema.index({ type: 1, docDate: -1 });
StockDocSchema.index({ type: 1, status: 1 });
StockDocSchema.index({ supplier: 1, type: 1 });
StockDocSchema.index({ against: 1 });
StockDocSchema.index({ "lines.item": 1 });

export type StockDocDoc = InferSchemaType<typeof StockDocSchema> & { _id: mongoose.Types.ObjectId };
export const StockDoc: Model<InferSchemaType<typeof StockDocSchema>> = mongoose.models.StockDoc ?? mongoose.model("StockDoc", StockDocSchema);

const LedgerSchema = new Schema(
  {
    at: { type: Date, required: true },
    store: { type: Schema.Types.ObjectId, ref: STORE, required: true },
    storeName: String,
    item: { type: Schema.Types.ObjectId, ref: ITEM, required: true },
    itemName: String,
    batch: { type: Schema.Types.ObjectId, ref: BATCH },
    batchNo: String,
    /** Signed quantity in issue units: + into the store, − out of it. */
    qty: { type: Number, required: true },
    rate: { type: Number, default: 0 },
    value: { type: Number, default: 0 },
    txn: { type: String, required: true },
    docType: String,
    docId: Schema.Types.ObjectId,
    docCode: String,
    party: String,
    department: String,
    byName: String,
  },
  { collection: "inventory_ledger", versionKey: false }
);
LedgerSchema.index({ item: 1, at: -1 });
LedgerSchema.index({ store: 1, item: 1, at: -1 });
LedgerSchema.index({ docId: 1 });
LedgerSchema.index({ at: -1 });

export const Ledger: Model<InferSchemaType<typeof LedgerSchema>> = mongoose.models.StockLedger ?? mongoose.model("StockLedger", LedgerSchema);
