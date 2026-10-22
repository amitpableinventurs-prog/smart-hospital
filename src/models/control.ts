import "server-only";
import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { COUPON_KINDS, LEAD_SOURCES, LEAD_STATUSES, PARTNER_TYPES, PAYMENT_METHODS, PAYMENT_STATUSES } from "@/lib/control-shared";
import { MODULE_KEYS } from "@/lib/modules";

/**
 * Control Panel only: hospitals licensed to run a client installation. Each
 * client's uploaded data lives in its own database (`dbName`) on this server.
 */

export const CLIENT_STATUSES = ["Active", "Suspended"] as const;

/** Per-client look and letterhead, sent to the installation (works offline once received). */
const BrandingSchema = new Schema(
  {
    appName: String,
    tagline: String,
    address: String,
    phone: String,
    email: String,
    website: String,
    gstin: String,
    /** #rrggbb; recolours the app. */
    color: String,
    /** Small JPEG/PNG data URL. */
    logo: String,
    printFooter: String,
  },
  { _id: false }
);

const ClientSchema = new Schema(
  {
    code: { type: String, required: true, unique: true },
    name: { type: String, required: true, trim: true },
    contactName: String,
    contactPhone: String,
    contactEmail: String,
    city: String,
    notes: String,
    /** SHA-256 of the licence key; the key itself is shown once when issued. */
    keyHash: { type: String, required: true, unique: true, select: false },
    keyLast4: String,
    modules: { type: [{ type: String, enum: MODULE_KEYS }], default: [] },
    status: { type: String, enum: CLIENT_STATUSES, default: "Active" },
    expiresAt: Date,
    graceDays: { type: Number, default: 15, min: 1, max: 365 },
    syncEnabled: { type: Boolean, default: true },
    notice: String,
    dbName: { type: String, required: true, unique: true },

    /** Subscription plan; its modules, grace period and user limit apply when it is assigned or paid for. */
    plan: { type: Schema.Types.ObjectId, ref: "ControlPlan" },
    planCode: String,
    planName: String,
    /** On the free trial (no payment yet). */
    trial: { type: Boolean, default: false },
    /** Staff logins allowed on the installation; 0 = unlimited. */
    maxUsers: { type: Number, default: 0, min: 0 },
    branding: { type: BrandingSchema, default: undefined },
    /** Changes whenever branding changes, so installations download it only then. */
    brandingAt: Date,
    /** Where this client came from (sales pipeline). */
    source: { type: String, enum: LEAD_SOURCES },
    partner: { type: Schema.Types.ObjectId, ref: "ControlPartner" },
    lead: { type: Schema.Types.ObjectId, ref: "ControlLead" },

    /** Custom domain and where its DNS must point (an IP for an A record, or a host name for a CNAME). */
    domain: String,
    dnsTarget: String,
    dnsCheck: { checkedAt: Date, ok: Boolean, found: [String], message: String },

    installationId: String,
    installTokenHash: { type: String, select: false },
    activatedAt: Date,
    activationHost: String,
    resyncRequestedAt: Date,

    lastSeenAt: Date,
    lastIp: String,
    lastVersion: String,
    lastHost: String,
    lastStats: Schema.Types.Mixed,
    lastSyncAt: Date,
    /** Per uploaded collection: { docs, lastAt }. */
    synced: { type: Schema.Types.Mixed, default: {} },
    createdByName: String,
  },
  { timestamps: true, collection: "control_clients", minimize: false }
);
ClientSchema.index({ contactEmail: 1 });
ClientSchema.index({ contactPhone: 1 });
ClientSchema.index({ expiresAt: 1 });

export type ClientDoc = InferSchemaType<typeof ClientSchema>;
export const ControlClient: Model<ClientDoc> = mongoose.models.ControlClient ?? mongoose.model("ControlClient", ClientSchema);

/* ======================= plans ======================= */

const PlanSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    description: String,
    features: { type: [String], default: [] },
    modules: { type: [{ type: String, enum: MODULE_KEYS }], default: [] },
    durationDays: { type: Number, required: true, min: 1, max: 3650 },
    /** Before GST, in INR. */
    price: { type: Number, required: true, min: 0 },
    gstPct: { type: Number, default: 18, min: 0, max: 28 },
    graceDays: { type: Number, default: 15, min: 1, max: 365 },
    maxUsers: { type: Number, default: 0, min: 0 },
    trial: { type: Boolean, default: false },
    public: { type: Boolean, default: true },
    active: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true, collection: "control_plans" }
);

export const ControlPlan: Model<InferSchemaType<typeof PlanSchema>> = mongoose.models.ControlPlan ?? mongoose.model("ControlPlan", PlanSchema);

/* ======================= licence payments ======================= */

/** One payment for a plan period: online through the vendor's Razorpay account, or recorded by hand. */
const PaymentSchema = new Schema(
  {
    code: { type: String, required: true, unique: true },
    client: { type: Schema.Types.ObjectId, ref: "ControlClient", required: true },
    clientCode: String,
    clientName: String,
    plan: { type: Schema.Types.ObjectId, ref: "ControlPlan", required: true },
    planCode: String,
    planName: String,
    durationDays: { type: Number, required: true },
    channel: { type: String, enum: ["Online", "Manual"], required: true },
    method: { type: String, enum: PAYMENT_METHODS, required: true },
    status: { type: String, enum: PAYMENT_STATUSES, default: "Created" },
    price: { type: Number, required: true },
    discount: { type: Number, default: 0 },
    coupon: { type: Schema.Types.ObjectId, ref: "ControlCoupon" },
    couponCode: String,
    taxable: { type: Number, required: true },
    gstPct: { type: Number, default: 0 },
    gst: { type: Number, default: 0 },
    total: { type: Number, required: true },
    reference: String,
    paidAt: Date,
    periodFrom: Date,
    periodTo: Date,
    partner: { type: Schema.Types.ObjectId, ref: "ControlPartner" },
    partnerName: String,
    commissionPct: { type: Number, default: 0 },
    commission: { type: Number, default: 0 },
    commissionPaid: { type: Boolean, default: false },
    /** Razorpay (online only): the vendor account the order was raised on. */
    account: { type: Schema.Types.ObjectId, ref: "GatewayAccount" },
    orderId: { type: String, unique: true, sparse: true },
    paymentId: String,
    keyId: String,
    mode: { type: String, enum: ["test", "live"] },
    error: String,
    notes: String,
    recordedByName: String,
  },
  { timestamps: true, collection: "control_payments" }
);
PaymentSchema.index({ client: 1, createdAt: -1 });
PaymentSchema.index({ status: 1, paidAt: -1 });

export const ControlPayment: Model<InferSchemaType<typeof PaymentSchema>> = mongoose.models.ControlPayment ?? mongoose.model("ControlPayment", PaymentSchema);

/* ======================= sales & marketing ======================= */

const LeadSchema = new Schema(
  {
    code: { type: String, required: true, unique: true },
    hospitalName: { type: String, required: true, trim: true },
    contactName: String,
    phone: String,
    email: String,
    city: String,
    beds: Number,
    source: { type: String, enum: LEAD_SOURCES, default: "Other" },
    status: { type: String, enum: LEAD_STATUSES, default: "New" },
    interestedPlan: { type: Schema.Types.ObjectId, ref: "ControlPlan" },
    partner: { type: Schema.Types.ObjectId, ref: "ControlPartner" },
    nextFollowUp: Date,
    notes: String,
    lostReason: String,
    client: { type: Schema.Types.ObjectId, ref: "ControlClient" },
    wonAt: Date,
    createdByName: String,
  },
  { timestamps: true, collection: "control_leads" }
);
LeadSchema.index({ status: 1, nextFollowUp: 1 });

export const ControlLead: Model<InferSchemaType<typeof LeadSchema>> = mongoose.models.ControlLead ?? mongoose.model("ControlLead", LeadSchema);

const PartnerSchema = new Schema(
  {
    code: { type: String, required: true, unique: true },
    name: { type: String, required: true, trim: true },
    partnerType: { type: String, enum: PARTNER_TYPES, default: "Referral" },
    contactName: String,
    phone: String,
    email: String,
    city: String,
    /** Of the amount before GST. */
    commissionPct: { type: Number, default: 10, min: 0, max: 100 },
    /** Entered by hospitals when they start a free trial. */
    referralCode: { type: String, required: true, unique: true, uppercase: true, trim: true },
    active: { type: Boolean, default: true },
    notes: String,
  },
  { timestamps: true, collection: "control_partners" }
);

export const ControlPartner: Model<InferSchemaType<typeof PartnerSchema>> = mongoose.models.ControlPartner ?? mongoose.model("ControlPartner", PartnerSchema);

const CouponSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    description: String,
    kind: { type: String, enum: COUPON_KINDS, default: "Percent" },
    value: { type: Number, required: true, min: 0 },
    validFrom: Date,
    validTo: Date,
    /** 0 = unlimited. */
    maxUses: { type: Number, default: 0, min: 0 },
    used: { type: Number, default: 0 },
    /** Empty = every plan. */
    plans: { type: [{ type: Schema.Types.ObjectId, ref: "ControlPlan" }], default: [] },
    /** Sales with this coupon earn this partner's commission. */
    partner: { type: Schema.Types.ObjectId, ref: "ControlPartner" },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, collection: "control_coupons" }
);

export const ControlCoupon: Model<InferSchemaType<typeof CouponSchema>> = mongoose.models.ControlCoupon ?? mongoose.model("ControlCoupon", CouponSchema);
