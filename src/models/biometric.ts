import "server-only";
import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { modelName } from "./records";

/**
 * Biometric attendance machines (ZKTeco / eSSL and other ADMS "push" devices)
 * and the raw punches they send. Punches are turned into daily attendance
 * marks by lib/biometric.ts.
 *
 * Machines report local wall-clock time with no zone, so `punchAt` stores that
 * wall-clock time as if it were UTC — the same convention as the attendance
 * register, whose dates are UTC midnights and times are "HH:MM" strings.
 */

export const DEVICE_STATUSES = ["Pending", "Active", "Disabled"] as const;
export const PUNCH_SOURCES = ["Device", "Import"] as const;

const DeviceSchema = new Schema(
  {
    serialNo: { type: String, required: true, unique: true, trim: true },
    name: { type: String, trim: true },
    location: { type: String, trim: true },
    status: { type: String, enum: DEVICE_STATUSES, default: "Pending" },
    lastSeenAt: Date,
    lastIp: String,
    lastPunchAt: Date,
    /** Last ATTLOG stamp the machine reported; sent back so it does not re-upload old logs. */
    attlogStamp: String,
    punchCount: { type: Number, default: 0 },
    approvedByName: String,
  },
  { timestamps: true, collection: "hr_biometric_devices" }
);

export const BiometricDevice: Model<InferSchemaType<typeof DeviceSchema>> =
  mongoose.models.HrBiometricDevice ?? mongoose.model("HrBiometricDevice", DeviceSchema);

const PunchSchema = new Schema(
  {
    /** User ID enrolled on the machine; matched to the employee's Biometric ID. */
    pin: { type: String, required: true },
    punchAt: { type: Date, required: true },
    /** Attendance day the punch counts towards (night-shift morning punches belong to the day before). */
    workDate: Date,
    staff: { type: Schema.Types.ObjectId, ref: modelName("hr", "staff") },
    staffName: String,
    staffCode: String,
    device: { type: Schema.Types.ObjectId, ref: "HrBiometricDevice" },
    deviceSerial: String,
    deviceName: String,
    verifyMode: String,
    state: String,
    source: { type: String, enum: PUNCH_SOURCES, default: "Device" },
    /** Why the punch did not update attendance (unknown ID, manual mark kept, payroll locked…); empty when applied. */
    note: String,
  },
  { timestamps: true, collection: "hr_biometric_punches" }
);
// A machine re-sends logs it thinks were not received; the same person cannot punch twice in one second.
PunchSchema.index({ pin: 1, punchAt: 1 }, { unique: true });
PunchSchema.index({ punchAt: -1 });
PunchSchema.index({ staff: 1, workDate: 1 });

export const BiometricPunch: Model<InferSchemaType<typeof PunchSchema>> =
  mongoose.models.HrBiometricPunch ?? mongoose.model("HrBiometricPunch", PunchSchema);
