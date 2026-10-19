import "server-only";
import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { MODULE_KEYS } from "@/lib/modules";

/**
 * Control Panel only: hospitals licensed to run a client installation. Each
 * client's uploaded data lives in its own database (`dbName`) on this server.
 */

export const CLIENT_STATUSES = ["Active", "Suspended"] as const;

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

export type ClientDoc = InferSchemaType<typeof ClientSchema>;
export const ControlClient: Model<ClientDoc> = mongoose.models.ControlClient ?? mongoose.model("ControlClient", ClientSchema);
