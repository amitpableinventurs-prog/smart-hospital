import "server-only";
import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { VOUCHER_TYPES } from "@/lib/accounts-shared";
import { modelName } from "./records";

const LEDGER = modelName("accounts", "ledgers");

/**
 * A double-entry voucher. Manual vouchers are entered in Accounts; automatic
 * ones are generated from the source documents of other modules (bills,
 * pharmacy sales, purchases, payments, payroll…) and regenerated whenever the
 * source changes, so they are never edited by hand.
 */

const EntrySchema = new Schema(
  {
    ledger: { type: Schema.Types.ObjectId, ref: LEDGER, required: true },
    ledgerName: { type: String, required: true },
    dr: { type: Number, default: 0, min: 0 },
    cr: { type: Number, default: 0, min: 0 },
    note: String,
  },
  { _id: false }
);

const VoucherSchema = new Schema(
  {
    code: { type: String, required: true },
    type: { type: String, enum: VOUCHER_TYPES, required: true },
    date: { type: Date, required: true },
    entries: { type: [EntrySchema], validate: (v: unknown[]) => v.length >= 2 },
    amount: { type: Number, required: true },
    narration: String,
    /** Cheque / UTR / supplier invoice number. */
    refNo: String,
    auto: { type: Boolean, default: false },
    /** Automatic vouchers: unique per source posting, e.g. "bill:<id>:rcpt:RCP-2026-000012". */
    key: String,
    sourceKind: String,
    sourceId: Schema.Types.ObjectId,
    sourceCode: String,
    status: { type: String, enum: ["Active", "Cancelled"], default: "Active" },
    cancelledAt: Date,
    cancelReason: String,
    cancelledByName: String,
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    createdByName: String,
    updatedByName: String,
  },
  { timestamps: true, collection: "accounts_vouchers" }
);
VoucherSchema.index({ date: -1 });
VoucherSchema.index({ type: 1, date: -1 });
VoucherSchema.index({ "entries.ledger": 1, date: 1 });
VoucherSchema.index({ sourceId: 1 });
VoucherSchema.index({ sourceKind: 1 });
VoucherSchema.index({ key: 1 }, { unique: true, sparse: true });
VoucherSchema.index({ code: 1 });

export type VoucherDoc = InferSchemaType<typeof VoucherSchema> & { _id: mongoose.Types.ObjectId };
export const Voucher: Model<InferSchemaType<typeof VoucherSchema>> = mongoose.models.AccountsVoucher ?? mongoose.model("AccountsVoucher", VoucherSchema);

/** One settings / posting-state document ("main"). */
const StateSchema = new Schema(
  {
    _id: { type: String, default: "main" },
    /** Payment mode → cash / bank ledger id. */
    modeLedgers: { type: Schema.Types.Mixed, default: {} },
    /** Source documents dated before this are not posted (opening balances cover them). */
    booksFrom: Date,
    /** GST state code of the hospital when it is not in the GSTIN. */
    stateCode: String,
    /** Last automatic-posting run per source kind. */
    checkpoints: { type: Schema.Types.Mixed, default: {} },
    lastRunAt: Date,
    lastRunSummary: Schema.Types.Mixed,
    updatedByName: String,
  },
  { collection: "accounts_state", timestamps: true }
);

export const AccountsState: Model<InferSchemaType<typeof StateSchema>> = mongoose.models.AccountsState ?? mongoose.model("AccountsState", StateSchema);
