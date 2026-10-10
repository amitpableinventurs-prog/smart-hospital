import "server-only";
import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

export const ACTIONS = [
  "login",
  "login_failed",
  "logout",
  "create",
  "update",
  "delete",
  "view",
  "admin_create",
  "admin_update",
  "admin_password_reset",
  "password_change",
] as const;
export type ActivityAction = (typeof ACTIONS)[number];

const ActivityLogSchema = new Schema(
  {
    actor: { type: Schema.Types.ObjectId, ref: "User" },
    actorName: String,
    actorEmail: String,
    actorRole: String,
    action: { type: String, enum: ACTIONS, required: true },
    /** Module key, or "system" for auth / admin-management events. */
    module: { type: String, required: true },
    resource: String,
    entityId: String,
    entityLabel: String,
    summary: { type: String, required: true },
    changedFields: [String],
    ip: String,
    userAgent: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

ActivityLogSchema.index({ createdAt: -1 });
ActivityLogSchema.index({ actor: 1, createdAt: -1 });
ActivityLogSchema.index({ module: 1, createdAt: -1 });
ActivityLogSchema.index({ entityId: 1, createdAt: -1 });

export const ActivityLog: Model<InferSchemaType<typeof ActivityLogSchema>> =
  mongoose.models.ActivityLog ?? mongoose.model("ActivityLog", ActivityLogSchema);
