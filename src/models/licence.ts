import "server-only";
import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

/**
 * Client installations only: the licence issued by the Control Panel (one
 * document) and how far each collection has been uploaded to it. Neither
 * collection is itself uploaded.
 */

export const LICENCE_STATUSES = ["Active", "Suspended", "Deactivated"] as const;

const LicenceSchema = new Schema(
  {
    _id: { type: String, default: "licence" },
    clientCode: { type: String, required: true },
    hospitalName: { type: String, required: true },
    /** Random id of this installation; the Control Panel binds the licence to it. */
    installationId: { type: String, required: true },
    installToken: { type: String, required: true, select: false },
    status: { type: String, enum: LICENCE_STATUSES, default: "Active" },
    modules: { type: [String], default: [] },
    expiresAt: Date,
    /** Days the app keeps working without reaching the Control Panel. */
    graceDays: { type: Number, default: 15 },
    syncEnabled: { type: Boolean, default: true },
    domain: String,
    /** Message from the vendor shown to everyone, e.g. a renewal reminder. */
    notice: String,
    activatedAt: Date,
    /** Last successful check-in; the offline grace period counts from here. */
    lastCheckAt: Date,
    lastAttemptAt: Date,
    lastError: String,
    /** Set by the Control Panel to upload everything again. */
    resyncRequestedAt: Date,
    planCode: String,
    planName: String,
    trial: { type: Boolean, default: false },
    /** Staff logins allowed; 0 = unlimited. */
    maxUsers: { type: Number, default: 0 },
    /** App name, colour, logo and letterhead for this hospital (lib/licence-protocol.ts Branding). */
    branding: Schema.Types.Mixed,
    brandingAt: Date,
    /** The vendor's contact details, shown when the licence needs attention. */
    vendor: Schema.Types.Mixed,
  },
  { timestamps: true, collection: "app_licence" }
);

export type LicenceDoc = InferSchemaType<typeof LicenceSchema>;
export const Licence: Model<LicenceDoc> = mongoose.models.AppLicence ?? mongoose.model("AppLicence", LicenceSchema);

const SyncStateSchema = new Schema(
  {
    /** Collection name. */
    _id: { type: String, required: true },
    /** updatedAt: changed documents · id: new documents (append-only) · full: whole collection when it changes. */
    mode: { type: String, enum: ["updatedAt", "id", "full"], required: true },
    /** updatedAt mode: when the first full pass began; changes after it are picked up incrementally. */
    initialFrom: Date,
    lastUpdatedAt: Date,
    lastId: Schema.Types.Mixed,
    /** Content hash of the last full upload. */
    lastHash: String,
    lastSyncAt: Date,
    lastReconcileAt: Date,
    sent: { type: Number, default: 0 },
    error: String,
  },
  { timestamps: true, collection: "app_sync_state" }
);

export const SyncState: Model<InferSchemaType<typeof SyncStateSchema>> = mongoose.models.AppSyncState ?? mongoose.model("AppSyncState", SyncStateSchema);

/** Collections that stay on the installation. */
export const LOCAL_ONLY_COLLECTIONS = ["app_licence", "app_sync_state"];
