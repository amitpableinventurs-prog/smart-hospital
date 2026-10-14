import "server-only";
import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

/**
 * Razorpay accounts. One hospital-wide account (scope "hospital", no user) plus
 * at most one per admin (scope "user"). Online payments an admin collects go to
 * their own account, falling back to the hospital account when it is shared.
 * The key secret is stored AES-GCM encrypted (see lib/razorpay.ts) and never leaves the server.
 */
const GatewayAccountSchema = new Schema(
  {
    scope: { type: String, enum: ["hospital", "user"], required: true },
    user: { type: Schema.Types.ObjectId, ref: "User" },
    provider: { type: String, enum: ["razorpay"], default: "razorpay" },
    keyId: { type: String, required: true },
    secretEnc: { type: String, required: true, select: false },
    secretLast4: String,
    mode: { type: String, enum: ["test", "live"], required: true },
    /** Shown as the business name in the Razorpay checkout. */
    displayName: { type: String, trim: true, maxlength: 80 },
    enabled: { type: Boolean, default: true },
    /** Hospital account only: admins without their own account may collect into it. */
    shared: { type: Boolean, default: true },
    verifiedAt: Date,
    updatedByName: String,
  },
  { timestamps: true, collection: "payment_gateway_accounts" }
);
GatewayAccountSchema.index({ scope: 1, user: 1 }, { unique: true });

export const GATEWAY_TXN_STATUSES = ["Created", "Applying", "Applied", "Unapplied", "Failed"] as const;
export const PAY_TARGETS = ["lab_order", "pharmacy_sale", "ambulance_trip"] as const;
export type PayTargetKind = (typeof PAY_TARGETS)[number];

/** One Razorpay order raised against a hospital record, and what became of it. */
const GatewayTxnSchema = new Schema(
  {
    account: { type: Schema.Types.ObjectId, ref: "GatewayAccount", required: true },
    accountScope: { type: String, enum: ["hospital", "user"] },
    accountLabel: String,
    keyId: String,
    mode: { type: String, enum: ["test", "live"] },
    targetKind: { type: String, enum: PAY_TARGETS, required: true },
    targetId: { type: Schema.Types.ObjectId, required: true },
    targetCode: String,
    module: String,
    payerName: String,
    amount: { type: Number, required: true },
    currency: { type: String, default: "INR" },
    orderId: { type: String, required: true, unique: true },
    paymentId: String,
    method: String,
    status: { type: String, enum: GATEWAY_TXN_STATUSES, default: "Created" },
    error: String,
    appliedAt: Date,
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    createdByName: String,
  },
  { timestamps: true, collection: "payment_gateway_transactions" }
);
GatewayTxnSchema.index({ targetKind: 1, targetId: 1, createdAt: -1 });
GatewayTxnSchema.index({ account: 1, createdAt: -1 });
GatewayTxnSchema.index({ createdBy: 1, createdAt: -1 });

export const GatewayAccount: Model<InferSchemaType<typeof GatewayAccountSchema>> =
  mongoose.models.GatewayAccount ?? mongoose.model("GatewayAccount", GatewayAccountSchema);
export const GatewayTxn: Model<InferSchemaType<typeof GatewayTxnSchema>> =
  mongoose.models.GatewayTxn ?? mongoose.model("GatewayTxn", GatewayTxnSchema);
