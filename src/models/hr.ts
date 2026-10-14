import "server-only";
import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { modelName } from "./records";

/**
 * Daily attendance marks and monthly payroll runs. Leave and holidays are not
 * stored here: they come from approved leave applications and the holiday list,
 * so the register always agrees with them.
 */

/** Marks an operator can store; "Leave" is derived from approved applications. */
export const ATTENDANCE_MARKS = ["Present", "Absent", "Half Day", "On Duty", "Week Off", "Holiday"] as const;
export const PAYROLL_STATUSES = ["Draft", "Finalised", "Paid"] as const;

const AttendanceSchema = new Schema(
  {
    staff: { type: Schema.Types.ObjectId, ref: modelName("hr", "staff"), required: true },
    date: { type: Date, required: true },
    status: { type: String, enum: ATTENDANCE_MARKS, required: true },
    inTime: String,
    outTime: String,
    lateMinutes: { type: Number, default: 0 },
    overtimeHours: { type: Number, default: 0, min: 0 },
    remarks: String,
    markedBy: { type: Schema.Types.ObjectId, ref: "User" },
    markedByName: String,
  },
  { timestamps: true, collection: "hr_attendance" }
);
AttendanceSchema.index({ staff: 1, date: 1 }, { unique: true });
AttendanceSchema.index({ date: 1 });

export const Attendance: Model<InferSchemaType<typeof AttendanceSchema>> = mongoose.models.HrAttendance ?? mongoose.model("HrAttendance", AttendanceSchema);

/* ---------- Payroll ---------- */

const RecoverySchema = new Schema({ advance: { type: Schema.Types.ObjectId, ref: modelName("hr", "advances") }, code: String, amount: Number }, { _id: false });

const PayLineSchema = new Schema({
  staff: { type: Schema.Types.ObjectId, ref: modelName("hr", "staff"), required: true },
  staffCode: String,
  name: { type: String, required: true },
  department: String,
  designation: String,
  category: String,
  joiningDate: Date,
  salaryMode: String,
  bankName: String,
  accountNo: String,
  ifsc: String,
  pan: String,
  uan: String,
  esiNumber: String,

  // Days
  monthDays: Number,
  payableDays: Number,
  lopDays: Number,
  presentDays: Number,
  paidLeaveDays: Number,
  unpaidLeaveDays: Number,
  absentDays: Number,
  holidays: Number,
  weekOffs: Number,
  unmarkedDays: Number,
  notEmployedDays: Number,
  otHours: Number,

  // Full-month structure (snapshot) and earned amounts
  grossRate: Number,
  basicRate: Number,
  daRate: Number,
  hraRate: Number,
  specialRate: Number,
  otherRate: Number,
  pfApplicable: Boolean,
  esiApplicable: Boolean,
  ptApplicable: Boolean,
  basic: Number,
  da: Number,
  hra: Number,
  special: Number,
  other: Number,
  overtime: Number,
  otherEarnings: { type: Number, default: 0 },
  grossEarned: Number,

  // Deductions
  pf: Number,
  esi: Number,
  pt: Number,
  tds: { type: Number, default: 0 },
  advance: Number,
  recoveries: { type: [RecoverySchema], default: [] },
  otherDeductions: { type: Number, default: 0 },
  totalDeductions: Number,
  employerPf: Number,
  employerEsi: Number,
  netPay: Number,
  remarks: String,
});

const PayrollRunSchema = new Schema(
  {
    code: { type: String, required: true, unique: true },
    /** "2026-10" */
    month: { type: String, required: true, unique: true },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    monthDays: { type: Number, required: true },
    unmarkedAsPresent: { type: Boolean, default: true },
    lines: { type: [PayLineSchema], default: [] },
    totals: Schema.Types.Mixed,
    status: { type: String, enum: PAYROLL_STATUSES, default: "Draft" },
    generatedAt: Date,
    generatedByName: String,
    finalisedAt: Date,
    finalisedByName: String,
    paidOn: Date,
    paymentReference: String,
    paidByName: String,
    notes: String,
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    createdByName: String,
  },
  { timestamps: true, collection: "hr_payroll_runs", optimisticConcurrency: true }
);
PayrollRunSchema.index({ "lines.staff": 1 });

export type PayrollRunDoc = InferSchemaType<typeof PayrollRunSchema> & { _id: mongoose.Types.ObjectId };
export const PayrollRun: Model<InferSchemaType<typeof PayrollRunSchema>> = mongoose.models.HrPayrollRun ?? mongoose.model("HrPayrollRun", PayrollRunSchema);
