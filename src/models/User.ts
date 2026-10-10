import "server-only";
import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { MODULE_KEYS, ROLES } from "@/lib/modules";

const UserSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
    phone: { type: String, trim: true, maxlength: 20 },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, required: true, default: "admin" },
    /** Modules this admin is allocated to. Ignored for super admins (full access). */
    modules: { type: [{ type: String, enum: MODULE_KEYS }], default: [] },
    active: { type: Boolean, default: true },
    /** Bumped on password reset / deactivation to invalidate existing sessions. */
    tokenVersion: { type: Number, default: 0 },
    lastLoginAt: Date,
    lastLoginIp: String,
    lastActiveAt: Date,
    failedLogins: { type: Number, default: 0, select: false },
    lockUntil: { type: Date, select: false },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

export type UserDoc = InferSchemaType<typeof UserSchema> & { _id: mongoose.Types.ObjectId };

export const User: Model<InferSchemaType<typeof UserSchema>> =
  mongoose.models.User ?? mongoose.model("User", UserSchema);
