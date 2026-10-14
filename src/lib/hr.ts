import "server-only";
import mongoose, { Types } from "mongoose";
import { ApiError, escapeRegex } from "./api";
import { logActivity } from "./audit";
import { r2 } from "./billing-math";
import { LEAVE_TYPES, STAFF_CATEGORIES, STAFF_DEPARTMENTS, WEEKDAYS } from "./modules";
import type { SessionUser } from "./session";
import { isObjectId } from "./validation";
import { nextCode } from "@/models/Counter";
import { ATTENDANCE_MARKS, Attendance, PayrollRun, type PayrollRunDoc } from "@/models/hr";
import { getRecordModel } from "@/models/records";

type Doc = Record<string, unknown> & { _id: Types.ObjectId };
type RunDoc = mongoose.HydratedDocument<PayrollRunDoc>;
type LineDoc = RunDoc["lines"][number];

const model = (m: string, r: string) => getRecordModel(m, r)!;
const Staff = () => model("hr", "staff");
const Leaves = () => model("hr", "leaves");
const Policies = () => model("hr", "leave_policies");
const Holidays = () => model("hr", "holidays");
const Advances = () => model("hr", "advances");
const Roster = () => model("nursing", "roster");

const DAY = 86_400_000;
/** Staff who are still on the rolls. */
export const WORKING_STATUSES = ["Active", "On Leave", "Notice Period"];
/** PF is computed on basic + DA up to this wage ceiling. */
const PF_WAGE_CEILING = 15_000;
const ESI_GROSS_LIMIT = 21_000;
/**
 * Professional tax per month by gross salary (Maharashtra slab; February is ₹300).
 * Adjust for your state.
 */
function professionalTax(gross: number, month: number) {
  if (gross <= 7_500) return 0;
  if (gross <= 10_000) return 175;
  return month === 1 ? 300 : 200;
}

/* ======================= helpers ======================= */

export function todayUtc() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function parseDay(v: unknown): Date | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : d;
}

function num(v: unknown, fallback = NaN) {
  if (v === "" || v === null || v === undefined) return fallback;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function text(v: unknown, max: number) {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function fail(errors: Record<string, string>, message = "Please correct the highlighted fields"): never {
  throw new ApiError(422, message, errors);
}

const dayKey = (d: Date) => d.toISOString().slice(0, 10);
const money = (n: number) => `₹${r2(n).toLocaleString("en-IN")}`;
const isoOrNull = (d: unknown) => (d instanceof Date ? d.toISOString() : null);

function* eachDay(from: Date, to: Date) {
  for (let t = from.getTime(); t <= to.getTime(); t += DAY) yield new Date(t);
}

/** "2026-10" → first and last day (UTC) of the month. */
function monthRange(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) fail({ month: "Select a valid month" });
  const [y, m] = month.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 0));
  return { start, end, days: end.getUTCDate(), monthIndex: m - 1 };
}

const monthOf = (d: Date) => d.toISOString().slice(0, 7);

/** Changes to attendance, leave or holidays are blocked once that month's payroll is finalised. */
export async function assertMonthOpen(dates: Date[], what = "this") {
  const months = [...new Set(dates.map(monthOf))];
  const locked = await PayrollRun.findOne({ month: { $in: months }, status: { $in: ["Finalised", "Paid"] } }).select("code month").lean();
  if (locked) throw new ApiError(409, `Payroll ${locked.code} for ${locked.month} is finalised; ${what} can no longer change. Reopen the payroll first.`);
}

/** Staff on the rolls on `date` (working, or left after it). */
function onRollsFilter(date: Date) {
  return {
    joiningDate: { $lte: date },
    $or: [
      { status: { $in: WORKING_STATUSES }, $or: [{ exitDate: null }, { exitDate: { $exists: false } }, { exitDate: { $gte: date } }] },
      { exitDate: { $gte: date } },
    ],
  };
}

async function holidaySet(from: Date, to: Date) {
  const rows = await Holidays().find({ date: { $gte: from, $lte: to } }).select("date name").lean<Doc[]>();
  return new Map(rows.map((h) => [dayKey(h.date as Date), String(h.name)]));
}

/* ======================= leave ======================= */

/**
 * Working days of a leave: holidays and the employee's weekly off are not
 * counted. A half-day session counts 0.5.
 */
export async function countLeaveDays(staff: Doc, from: Date, to: Date, session: string) {
  const holidays = await holidaySet(from, to);
  const off = staff.weeklyOff && staff.weeklyOff !== "Rotational" ? String(staff.weeklyOff) : null;
  let days = 0;
  for (const d of eachDay(from, to)) {
    if (holidays.has(dayKey(d))) continue;
    if (off && WEEKDAYS[d.getUTCDay()] === off) continue;
    days++;
  }
  return session && session !== "Full day" ? Math.min(days, 1) * 0.5 : days;
}

interface PolicyRow {
  leaveType: string;
  quota: number | null;
  paid: boolean;
  carryForwardMax: number;
  halfDayAllowed: boolean;
  appliesTo: string;
  minServiceDays: number;
}

export async function leavePolicies(): Promise<Map<string, PolicyRow>> {
  const rows = await Policies().find({ status: "Active" }).lean<Doc[]>();
  return new Map(
    rows.map((p) => [
      String(p.leaveType),
      {
        leaveType: String(p.leaveType),
        quota: typeof p.annualQuota === "number" ? p.annualQuota : null,
        // Unpaid leave is never paid, whatever the policy says.
        paid: p.paid !== "No" && p.leaveType !== "Unpaid",
        carryForwardMax: typeof p.carryForwardMax === "number" ? p.carryForwardMax : 0,
        halfDayAllowed: p.halfDayAllowed !== "No",
        appliesTo: String(p.appliesTo ?? "All"),
        minServiceDays: typeof p.minServiceDays === "number" ? p.minServiceDays : 0,
      },
    ])
  );
}

/** Days of `leaveType` taken (approved) and applied (pending) by each staff member in a calendar year. */
async function leaveUsage(year: number, staffIds?: Types.ObjectId[], exclude?: unknown) {
  const from = new Date(Date.UTC(year, 0, 1));
  const to = new Date(Date.UTC(year, 11, 31));
  const rows = await Leaves()
    .aggregate<{ _id: { staff: Types.ObjectId; type: string; status: string }; days: number }>([
      {
        $match: {
          status: { $in: ["Approved", "Pending"] },
          fromDate: { $gte: from, $lte: to },
          ...(staffIds ? { staff: { $in: staffIds } } : {}),
          ...(exclude ? { _id: { $ne: exclude } } : {}),
        },
      },
      { $group: { _id: { staff: "$staff", type: "$leaveType", status: "$status" }, days: { $sum: "$days" } } },
    ]);
  const out = new Map<string, { taken: number; pending: number }>();
  for (const r of rows) {
    const key = `${r._id.staff}:${r._id.type}`;
    const cur = out.get(key) ?? { taken: 0, pending: 0 };
    if (r._id.status === "Approved") cur.taken += r.days;
    else cur.pending += r.days;
    out.set(key, cur);
  }
  return out;
}

/** Entitlement for a year: the policy quota plus unused days carried from the previous year (capped). */
function entitlement(policy: PolicyRow, prevTaken: number, joining: Date | null, year: number) {
  if (policy.quota === null) return null;
  // Staff joining mid-year get a pro-rata share of the year's quota.
  const yearStart = Date.UTC(year, 0, 1);
  const share = joining && joining.getTime() > yearStart ? Math.max(0, (Date.UTC(year, 11, 31) - joining.getTime()) / DAY + 1) / 365 : 1;
  const quota = Math.round(policy.quota * Math.min(1, share) * 2) / 2;
  const joinedBeforePrev = !joining || joining.getTime() < Date.UTC(year - 1, 0, 1);
  const carried = policy.carryForwardMax > 0 && joinedBeforePrev ? Math.min(policy.carryForwardMax, Math.max(0, policy.quota - prevTaken)) : 0;
  return { quota, carried, total: quota + carried };
}

/**
 * Check a leave application against its policy and balance.
 * Throws a field error when it is not allowed.
 */
export async function checkLeaveBalance(staff: Doc, leaveType: string, from: Date, days: number, session: string, exclude?: unknown) {
  const policies = await leavePolicies();
  const policy = policies.get(leaveType);
  if (!policy) {
    if (leaveType === "Unpaid") return;
    fail({ leaveType: `No active leave policy for ${leaveType} leave. Add it under HR → Leave Policy.` });
  }
  if (policy.appliesTo !== "All" && staff.gender && staff.gender !== policy.appliesTo) fail({ leaveType: `${leaveType} leave applies to ${policy.appliesTo.toLowerCase()} employees only` });
  if (session !== "Full day" && !policy.halfDayAllowed) fail({ session: `${leaveType} leave cannot be taken as a half day` });
  const joining = staff.joiningDate instanceof Date ? staff.joiningDate : null;
  if (policy.minServiceDays && joining && (from.getTime() - joining.getTime()) / DAY < policy.minServiceDays) {
    fail({ leaveType: `${leaveType} leave is available after ${policy.minServiceDays} days of service` });
  }
  const year = from.getUTCFullYear();
  const [usage, prev] = await Promise.all([leaveUsage(year, [staff._id], exclude), leaveUsage(year - 1, [staff._id])]);
  const ent = entitlement(policy, prev.get(`${staff._id}:${leaveType}`)?.taken ?? 0, joining, year);
  if (!ent) return;
  const used = usage.get(`${staff._id}:${leaveType}`);
  const available = r2(ent.total - (used?.taken ?? 0) - (used?.pending ?? 0));
  if (days > available) fail({ leaveType: available > 0 ? `Only ${available} day(s) of ${leaveType} leave left in ${year} (including pending applications)` : `No ${leaveType} leave left in ${year}` });
}

export async function leaveBalances(url: URL) {
  const year = Math.floor(num(url.searchParams.get("year"), new Date().getUTCFullYear()));
  if (!(year >= 2000 && year <= 2100)) fail({ year: "Select a valid year" });
  const q = text(url.searchParams.get("search"), 60);
  const department = url.searchParams.get("department");
  const filter: Record<string, unknown> = { status: { $in: WORKING_STATUSES } };
  if (q) filter.$or = [{ fullName: new RegExp(escapeRegex(q), "i") }, { code: new RegExp(escapeRegex(q), "i") }];
  if (department && (STAFF_DEPARTMENTS as readonly string[]).includes(department)) filter.department = department;
  const staff = await Staff().find(filter).sort({ fullName: 1 }).limit(300).select("code fullName department designation gender joiningDate").lean<Doc[]>();
  const ids = staff.map((s) => s._id);
  const [policies, usage, prev] = await Promise.all([leavePolicies(), leaveUsage(year, ids), leaveUsage(year - 1, ids)]);
  const types = LEAVE_TYPES.filter((t) => policies.has(t));
  return {
    year,
    types: types.map((t) => ({ leaveType: t, quota: policies.get(t)!.quota, paid: policies.get(t)!.paid })),
    rows: staff.map((s) => ({
      id: String(s._id),
      code: (s.code as string) ?? "",
      name: String(s.fullName),
      department: (s.department as string) ?? "",
      designation: (s.designation as string) ?? "",
      balances: types.map((t) => {
        const p = policies.get(t)!;
        const applies = p.appliesTo === "All" || !s.gender || s.gender === p.appliesTo;
        const u = usage.get(`${s._id}:${t}`) ?? { taken: 0, pending: 0 };
        const ent = applies ? entitlement(p, prev.get(`${s._id}:${t}`)?.taken ?? 0, s.joiningDate instanceof Date ? s.joiningDate : null, year) : null;
        return {
          leaveType: t,
          applies,
          entitled: ent?.total ?? null,
          carried: ent?.carried ?? 0,
          taken: r2(u.taken),
          pending: r2(u.pending),
          balance: ent ? r2(ent.total - u.taken - u.pending) : null,
        };
      }),
    })),
  };
}

/** Approved leave of these staff overlapping the period, by staff id. */
async function approvedLeaves(staffIds: Types.ObjectId[], from: Date, to: Date) {
  const rows = await Leaves()
    .find({ staff: { $in: staffIds }, status: "Approved", fromDate: { $lte: to }, toDate: { $gte: from } })
    .select("staff leaveType fromDate toDate session code")
    .lean<Doc[]>();
  const out = new Map<string, Doc[]>();
  for (const r of rows) out.set(String(r.staff), [...(out.get(String(r.staff)) ?? []), r]);
  return out;
}

function leaveOn(leaves: Doc[] | undefined, d: Date) {
  return leaves?.find((l) => (l.fromDate as Date) <= d && (l.toDate as Date) >= d) ?? null;
}

/** Throws unless the staff member can work on `date` (on the rolls and not on approved leave). */
export async function assertAvailable(staff: Doc, date: Date, field: string) {
  const name = String(staff.fullName);
  if (!WORKING_STATUSES.includes(String(staff.status)) && !(staff.exitDate instanceof Date && staff.exitDate >= date)) fail({ [field]: `${name} is ${String(staff.status).toLowerCase()}` });
  if (staff.joiningDate instanceof Date && staff.joiningDate > date) fail({ [field]: `${name} joins on ${dayKey(staff.joiningDate)}` });
  if (staff.exitDate instanceof Date && staff.exitDate < date) fail({ [field]: `${name} left on ${dayKey(staff.exitDate)}` });
  const leave = await Leaves().findOne({ staff: staff._id, status: "Approved", fromDate: { $lte: date }, toDate: { $gte: date } }).select("code leaveType fromDate toDate session").lean<Doc>();
  if (leave && leave.session === "Full day") fail({ [field]: `${name} is on approved ${leave.leaveType} leave ${dayKey(leave.fromDate as Date)} to ${dayKey(leave.toDate as Date)} (${leave.code})` });
}

/* ======================= attendance ======================= */

function minutesOf(hhmm: unknown) {
  if (typeof hhmm !== "string" || !/^\d{2}:\d{2}$/.test(hhmm)) return null;
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export async function attendanceRegister(url: URL) {
  const date = parseDay(url.searchParams.get("date")) ?? todayUtc();
  const department = url.searchParams.get("department");
  const category = url.searchParams.get("category");
  const q = text(url.searchParams.get("search"), 60);
  const filter: Record<string, unknown> = onRollsFilter(date);
  if (department && (STAFF_DEPARTMENTS as readonly string[]).includes(department)) filter.department = department;
  if (category && (STAFF_CATEGORIES as readonly string[]).includes(category)) filter.staffCategory = category;
  if (q) filter.$and = [{ $or: [{ fullName: new RegExp(escapeRegex(q), "i") }, { code: new RegExp(escapeRegex(q), "i") }] }];
  const staff = await Staff().find(filter).sort({ department: 1, fullName: 1 }).limit(500).select("code fullName department designation staffCategory weeklyOff shift").populate({ path: "shift", select: "name code startTime endTime" }).lean<Doc[]>();
  const ids = staff.map((s) => s._id);
  const [marks, leaves, holidays, run] = await Promise.all([
    Attendance.find({ staff: { $in: ids }, date }).lean(),
    approvedLeaves(ids, date, date),
    holidaySet(date, date),
    PayrollRun.findOne({ month: monthOf(date), status: { $in: ["Finalised", "Paid"] } }).select("code").lean(),
  ]);
  const byStaff = new Map(marks.map((m) => [String(m.staff), m]));
  const weekday = WEEKDAYS[date.getUTCDay()];
  const rows = staff.map((s) => {
    const m = byStaff.get(String(s._id));
    const leave = leaveOn(leaves.get(String(s._id)), date);
    const shift = s.shift && typeof s.shift === "object" ? (s.shift as Doc) : null;
    // What the day is when nothing is marked: approved leave, a holiday or the weekly off.
    const derived = leave ? (leave.session === "Full day" ? "Leave" : "Half-day leave") : holidays.has(dayKey(date)) ? "Holiday" : s.weeklyOff === weekday ? "Week Off" : null;
    return {
      id: String(s._id),
      code: (s.code as string) ?? "",
      name: String(s.fullName),
      department: (s.department as string) ?? "",
      designation: (s.designation as string) ?? "",
      category: (s.staffCategory as string) ?? "",
      shift: shift ? `${shift.code ?? shift.name} ${shift.startTime}–${shift.endTime}` : null,
      leave: leave ? `${leave.leaveType}${leave.session !== "Full day" ? ` (${String(leave.session).toLowerCase()})` : ""} · ${leave.code ?? ""}` : null,
      fullDayLeave: !!leave && leave.session === "Full day",
      derived,
      status: m?.status ?? null,
      inTime: m?.inTime ?? null,
      outTime: m?.outTime ?? null,
      lateMinutes: m?.lateMinutes ?? 0,
      overtimeHours: m?.overtimeHours ?? 0,
      remarks: m?.remarks ?? null,
      markedByName: m?.markedByName ?? null,
    };
  });
  const count = (s: string) => rows.filter((r) => (r.status ?? r.derived) === s).length;
  return {
    date: dayKey(date),
    holiday: holidays.get(dayKey(date)) ?? null,
    locked: run ? run.code : null,
    rows,
    summary: { total: rows.length, present: count("Present") + count("On Duty"), halfDay: count("Half Day"), absent: count("Absent"), leave: count("Leave"), off: count("Week Off") + count("Holiday"), unmarked: rows.filter((r) => !r.status && !r.derived).length, late: rows.filter((r) => r.lateMinutes > 0).length },
  };
}

/** { date, entries: [{ staff, status ("" clears the mark), inTime?, outTime?, overtimeHours?, remarks? }] } */
export async function saveAttendance(body: Record<string, unknown>, user: SessionUser, req: Request) {
  const date = parseDay(body.date);
  if (!date) fail({ date: "Select the date" });
  if (date > todayUtc()) fail({ date: "Attendance cannot be marked for a future date" });
  await assertMonthOpen([date], "attendance");
  const entries = (Array.isArray(body.entries) ? body.entries : []).slice(0, 501) as Record<string, unknown>[];
  if (!entries.length) fail({ entries: "Nothing to save" });
  if (entries.length > 500) fail({ entries: "At most 500 entries at a time" });
  const ids = entries.map((e) => e.staff).filter(isObjectId);
  const staff = await Staff().find({ _id: { $in: ids } }).populate({ path: "shift", select: "startTime graceMinutes" }).lean<Doc[]>();
  const sMap = new Map(staff.map((s) => [String(s._id), s]));
  const leaves = await approvedLeaves(staff.map((s) => s._id), date, date);
  const errors: Record<string, string> = {};
  const ops: mongoose.AnyBulkWriteOperation[] = [];
  let marked = 0;
  let cleared = 0;

  entries.forEach((e, i) => {
    const s = sMap.get(String(e.staff));
    const key = `entries.${i}`;
    if (!s) return void (errors[key] = "Employee not found");
    const name = String(s.fullName);
    const status = String(e.status ?? "");
    if (!status) {
      ops.push({ deleteOne: { filter: { staff: s._id, date } } });
      cleared++;
      return;
    }
    if (!(ATTENDANCE_MARKS as readonly string[]).includes(status)) return void (errors[key] = `${name}: invalid status`);
    if (s.joiningDate instanceof Date && s.joiningDate > date) return void (errors[key] = `${name} had not joined on this date`);
    if (s.exitDate instanceof Date && s.exitDate < date) return void (errors[key] = `${name} had left before this date`);
    const leave = leaveOn(leaves.get(String(s._id)), date);
    if (leave && leave.session === "Full day" && status !== "Absent") return void (errors[key] = `${name} is on approved leave (${leave.code}). Cancel the leave to mark attendance.`);
    const inTime = text(e.inTime, 5) || undefined;
    const outTime = text(e.outTime, 5) || undefined;
    if ((inTime && minutesOf(inTime) === null) || (outTime && minutesOf(outTime) === null)) return void (errors[key] = `${name}: enter times as HH:MM`);
    const working = status === "Present" || status === "Half Day" || status === "On Duty";
    const ot = r2(num(e.overtimeHours, 0));
    if (!(ot >= 0 && ot <= 16)) return void (errors[key] = `${name}: overtime must be 0–16 hours`);
    if (ot > 0 && !working) return void (errors[key] = `${name}: overtime needs a working status`);
    const shift = s.shift && typeof s.shift === "object" ? (s.shift as Doc) : null;
    const start = minutesOf(shift?.startTime);
    const inMin = minutesOf(inTime);
    const late = working && start !== null && inMin !== null ? Math.max(0, inMin - start - Number(shift?.graceMinutes ?? 0)) : 0;
    ops.push({
      updateOne: {
        filter: { staff: s._id, date },
        update: {
          $set: { status, inTime: working ? inTime : undefined, outTime: working ? outTime : undefined, lateMinutes: late, overtimeHours: working ? ot : 0, remarks: text(e.remarks, 200) || undefined, markedBy: new Types.ObjectId(user.id), markedByName: user.name },
          $setOnInsert: { staff: s._id, date },
        },
        upsert: true,
      },
    });
    marked++;
  });
  if (Object.keys(errors).length) fail(errors, Object.values(errors)[0]);
  if (ops.length) await Attendance.bulkWrite(ops, { ordered: false });
  await logActivity({ req, user, action: "update", module: "hr", resource: "attendance", entityLabel: dayKey(date), summary: `Marked attendance for ${dayKey(date)}: ${marked} employee(s)${cleared ? `, cleared ${cleared}` : ""}` });
  return { marked, cleared };
}

/** Per-employee totals for a month (also the base of payroll). */
async function monthTally(staff: Doc[], start: Date, end: Date, unmarkedAsPresent: boolean) {
  const ids = staff.map((s) => s._id);
  const [marks, leaves, holidays, policies] = await Promise.all([
    Attendance.find({ staff: { $in: ids }, date: { $gte: start, $lte: end } }).select("staff date status overtimeHours lateMinutes").lean(),
    approvedLeaves(ids, start, end),
    holidaySet(start, end),
    leavePolicies(),
  ]);
  const markMap = new Map(marks.map((m) => [`${m.staff}:${dayKey(m.date)}`, m]));
  const paidLeave = (type: unknown) => (type === "Unpaid" ? false : (policies.get(String(type))?.paid ?? true));
  return new Map(
    staff.map((s) => {
      const t = { present: 0, paidLeave: 0, unpaidLeave: 0, absent: 0, halfDays: 0, holidays: 0, weekOffs: 0, unmarked: 0, notEmployed: 0, otHours: 0, lateDays: 0 };
      const from = s.joiningDate instanceof Date && s.joiningDate > start ? s.joiningDate : start;
      const to = s.exitDate instanceof Date && s.exitDate < end ? s.exitDate : end;
      const own = leaves.get(String(s._id));
      for (const d of eachDay(start, end)) {
        if (d < from || d > to) {
          t.notEmployed++;
          continue;
        }
        const m = markMap.get(`${s._id}:${dayKey(d)}`);
        const leave = leaveOn(own, d);
        const half = !!leave && leave.session !== "Full day";
        const addLeave = (n: number) => (paidLeave(leave!.leaveType) ? (t.paidLeave += n) : (t.unpaidLeave += n));
        if (m) {
          t.otHours += m.overtimeHours ?? 0;
          if ((m.lateMinutes ?? 0) > 0) t.lateDays++;
          if (m.status === "Present" || m.status === "On Duty") t.present++;
          else if (m.status === "Half Day") {
            t.halfDays++;
            t.present += 0.5;
            if (half) addLeave(0.5);
            else t.absent += 0.5;
          } else if (m.status === "Absent") {
            if (leave) addLeave(half ? 0.5 : 1);
            if (!leave || half) t.absent += half ? 0.5 : 1;
          } else if (m.status === "Holiday") t.holidays++;
          else t.weekOffs++;
          continue;
        }
        if (holidays.has(dayKey(d))) t.holidays++;
        else if (s.weeklyOff === WEEKDAYS[d.getUTCDay()]) t.weekOffs++;
        else if (leave) {
          addLeave(half ? 0.5 : 1);
          if (half) {
            if (unmarkedAsPresent) t.present += 0.5;
            else t.unmarked += 0.5;
          }
        } else if (unmarkedAsPresent) t.present++;
        else t.unmarked++;
      }
      return [String(s._id), t];
    })
  );
}

/* ======================= payroll ======================= */

/** Earnings and deductions of one line from its day counts, rates and manual adjustments. */
function computeLine(line: LineDoc, monthIndex: number, advances: Doc[]) {
  const factor = line.monthDays ? (line.payableDays ?? 0) / line.monthDays : 0;
  const earn = (rate: unknown) => Math.round(Number(rate ?? 0) * factor);
  line.basic = earn(line.basicRate);
  line.da = earn(line.daRate);
  line.hra = earn(line.hraRate);
  line.special = earn(line.specialRate);
  line.other = earn(line.otherRate);
  // Overtime at the ordinary hourly rate: monthly gross ÷ (days × 8 hours).
  line.overtime = line.monthDays ? Math.round(((line.otHours ?? 0) * (line.grossRate ?? 0)) / (line.monthDays * 8)) : 0;
  line.grossEarned = r2(line.basic + line.da + line.hra + line.special + line.other + line.overtime + (line.otherEarnings ?? 0));

  const pfWage = Math.min(line.basic + line.da, PF_WAGE_CEILING);
  line.pf = line.pfApplicable ? Math.round(pfWage * 0.12) : 0;
  line.employerPf = line.pfApplicable ? Math.round(pfWage * 0.12) : 0;
  const esi = line.esiApplicable && (line.grossRate ?? 0) <= ESI_GROSS_LIMIT;
  line.esi = esi ? Math.ceil(line.grossEarned * 0.0075) : 0;
  line.employerEsi = esi ? Math.ceil(line.grossEarned * 0.0325) : 0;
  line.pt = line.ptApplicable && line.grossEarned > 0 ? professionalTax(line.grossEarned, monthIndex) : 0;

  // Advance recovery never takes net pay below zero; oldest advance first.
  let room = Math.max(0, line.grossEarned - line.pf - line.esi - line.pt - (line.tds ?? 0) - (line.otherDeductions ?? 0));
  const recoveries: { advance: Types.ObjectId; code: string; amount: number }[] = [];
  for (const a of advances) {
    if (room <= 0) break;
    const amount = Math.min(Number(a.monthlyDeduction ?? 0), Number(a.balance ?? 0), room);
    if (amount > 0) {
      recoveries.push({ advance: a._id, code: String(a.code ?? ""), amount: r2(amount) });
      room -= amount;
    }
  }
  line.recoveries = recoveries as unknown as LineDoc["recoveries"];
  line.advance = r2(recoveries.reduce((s, r) => s + r.amount, 0));
  line.totalDeductions = r2(line.pf + line.esi + line.pt + (line.tds ?? 0) + line.advance + (line.otherDeductions ?? 0));
  line.netPay = r2(line.grossEarned - line.totalDeductions);
}

function runTotals(run: RunDoc) {
  const sum = (k: keyof LineDoc) => r2(run.lines.reduce((s, l) => s + Number(l[k] ?? 0), 0));
  run.totals = {
    staff: run.lines.length,
    gross: sum("grossEarned"),
    deductions: sum("totalDeductions"),
    net: sum("netPay"),
    pf: sum("pf"),
    esi: sum("esi"),
    pt: sum("pt"),
    tds: sum("tds"),
    advance: sum("advance"),
    overtime: sum("overtime"),
    employerPf: sum("employerPf"),
    employerEsi: sum("employerEsi"),
    lopDays: sum("lopDays"),
    ctc: r2(sum("grossEarned") + sum("employerPf") + sum("employerEsi")),
  };
}

async function activeAdvances(staffIds: Types.ObjectId[]) {
  const rows = await Advances().find({ staff: { $in: staffIds }, status: "Active", balance: { $gt: 0 } }).sort({ issueDate: 1 }).lean<Doc[]>();
  const out = new Map<string, Doc[]>();
  for (const a of rows) out.set(String(a.staff), [...(out.get(String(a.staff)) ?? []), a]);
  return out;
}

function plainRun(run: Record<string, unknown>) {
  return JSON.parse(JSON.stringify({ ...run, id: String(run._id) }));
}

async function loadRun(id: string) {
  if (!isObjectId(id)) throw new ApiError(404, "Payroll run not found");
  const run = await PayrollRun.findById(id);
  if (!run) throw new ApiError(404, "Payroll run not found");
  return run as unknown as RunDoc;
}

async function saveRun(run: RunDoc) {
  try {
    await run.save();
  } catch (err) {
    if (err instanceof mongoose.Error.VersionError) throw new ApiError(409, "This payroll was just changed by someone else. Refresh and try again.");
    throw err;
  }
}

function audit(req: Request, user: SessionUser, run: { _id: unknown; code: string }, summary: string, action: "create" | "update" | "delete" = "update") {
  return logActivity({ req, user, action, module: "hr", resource: "payroll", entityId: String(run._id), entityLabel: run.code, summary });
}

export async function listPayroll() {
  const runs = await PayrollRun.find().sort({ month: -1 }).limit(36).select("-lines").lean();
  return runs.map((r) => ({ id: String(r._id), code: r.code, month: r.month, status: r.status, totals: r.totals ?? null, generatedAt: isoOrNull(r.generatedAt), finalisedAt: isoOrNull(r.finalisedAt), paidOn: isoOrNull(r.paidOn), unmarkedAsPresent: r.unmarkedAsPresent }));
}

export async function getPayroll(id: string) {
  const run = await loadRun(id);
  const open = new Date(Date.UTC(Number(run.month.slice(0, 4)), Number(run.month.slice(5)), 1)) > todayUtc();
  return { ...plainRun(run.toObject()), monthInProgress: open, hospital: { name: process.env.HOSPITAL_NAME || "MediCare Hospital", address: process.env.HOSPITAL_ADDRESS || "" } };
}

/** Build lines for every employee on the rolls during the month. Manual adjustments of a regenerated draft are kept. */
async function buildLines(run: RunDoc) {
  const { start, end, days, monthIndex } = monthRange(run.month);
  const staff = await Staff()
    .find({ joiningDate: { $lte: end }, $or: [{ status: { $in: WORKING_STATUSES } }, { exitDate: { $gte: start } }] })
    .sort({ department: 1, fullName: 1 })
    .lean<Doc[]>();
  const counts = await monthTally(staff, start, end, run.unmarkedAsPresent !== false);
  const advances = await activeAdvances(staff.map((s) => s._id));
  const previous = new Map(run.lines.map((l) => [String(l.staff), l]));
  const lines: LineDoc[] = [];
  for (const s of staff) {
    const t = counts.get(String(s._id))!;
    const n = (k: string) => (typeof s[k] === "number" ? (s[k] as number) : 0);
    // Staff recorded before the salary structure existed are paid their monthly salary as basic.
    const basicRate = typeof s.basicPay === "number" ? s.basicPay : n("salary");
    const grossRate = basicRate + n("da") + n("hra") + n("specialAllowance") + n("otherAllowance");
    if (grossRate <= 0) continue;
    const lop = r2(t.absent + t.unpaidLeave + t.unmarked + t.notEmployed);
    const prev = previous.get(String(s._id));
    const line = {
      staff: s._id, staffCode: s.code, name: s.fullName, department: s.department, designation: s.designation, category: s.staffCategory, joiningDate: s.joiningDate,
      salaryMode: s.salaryMode ?? "Bank Transfer", bankName: s.bankName, accountNo: s.accountNo, ifsc: s.ifsc, pan: s.pan, uan: s.uan, esiNumber: s.esiNumber,
      monthDays: days, payableDays: r2(Math.max(0, days - lop)), lopDays: lop, presentDays: r2(t.present), paidLeaveDays: r2(t.paidLeave), unpaidLeaveDays: r2(t.unpaidLeave),
      absentDays: r2(t.absent), holidays: t.holidays, weekOffs: t.weekOffs, unmarkedDays: r2(t.unmarked), notEmployedDays: t.notEmployed, otHours: r2(t.otHours),
      grossRate, basicRate, daRate: n("da"), hraRate: n("hra"), specialRate: n("specialAllowance"), otherRate: n("otherAllowance"),
      pfApplicable: s.pfApplicable !== "No", esiApplicable: s.esiApplicable !== "No", ptApplicable: s.ptApplicable !== "No",
      otherEarnings: prev?.otherEarnings ?? 0, otherDeductions: prev?.otherDeductions ?? 0, tds: prev?.tds ?? 0, remarks: prev?.remarks,
    } as unknown as LineDoc;
    computeLine(line, monthIndex, advances.get(String(s._id)) ?? []);
    lines.push(line);
  }
  run.set("lines", lines);
  run.monthDays = days;
  runTotals(run);
}

/** { month: "2026-10", unmarkedAsPresent?: boolean } — creates the draft or regenerates it. */
export async function generatePayroll(body: Record<string, unknown>, user: SessionUser, req: Request) {
  const month = text(body.month, 7);
  const { start, end } = monthRange(month);
  if (start > todayUtc()) fail({ month: "Payroll cannot be prepared for a future month" });
  const unmarkedAsPresent = body.unmarkedAsPresent !== false;
  let run = (await PayrollRun.findOne({ month })) as unknown as RunDoc | null;
  const created = !run;
  if (run && run.status !== "Draft") throw new ApiError(409, `Payroll for ${month} is already ${run.status.toLowerCase()} (${run.code}). Reopen it to regenerate.`);
  if (!run) {
    run = new PayrollRun({ code: await nextCode("PAY"), month, periodStart: start, periodEnd: end, monthDays: end.getUTCDate(), createdBy: user.id, createdByName: user.name }) as unknown as RunDoc;
  }
  run.unmarkedAsPresent = unmarkedAsPresent;
  await buildLines(run);
  if (!run.lines.length) fail({ month: "No employees with a salary structure were on the rolls in this month" });
  run.generatedAt = new Date();
  run.generatedByName = user.name;
  await saveRun(run);
  const t = run.totals as Record<string, number>;
  await audit(req, user, run, `${created ? "Prepared" : "Regenerated"} payroll ${run.code} for ${month}: ${t.staff} employee(s), gross ${money(t.gross)}, net ${money(t.net)}`, created ? "create" : "update");
  return getPayroll(String(run._id));
}

/** Move an advance's recovered amount by `delta`, re-deriving its balance and status in one write. */
function recoverAdvance(advance: unknown, delta: number) {
  return Advances().updateOne(
    { _id: advance },
    [
      { $set: { recovered: { $round: [{ $add: [{ $ifNull: ["$recovered", 0] }, delta] }, 2] } } },
      { $set: { balance: { $round: [{ $subtract: ["$amount", "$recovered"] }, 2] } } },
      { $set: { status: { $cond: [{ $lte: ["$balance", 0] }, "Closed", "Active"] } } },
    ],
    { updatePipeline: true }
  );
}

/** Apply (+1) or reverse (−1) the advance recoveries of a run; all or nothing. */
async function postRecoveries(run: RunDoc, sign: 1 | -1) {
  const done: { advance: unknown; delta: number }[] = [];
  try {
    for (const line of run.lines) {
      for (const r of line.recoveries) {
        const delta = sign * Number(r.amount ?? 0);
        if (!delta || !r.advance) continue;
        await recoverAdvance(r.advance, delta);
        done.push({ advance: r.advance, delta });
      }
    }
  } catch (err) {
    for (const d of done.reverse()) await recoverAdvance(d.advance, -d.delta).catch(() => {});
    throw err;
  }
}

/** Put a run back to `status` when posting its recoveries failed after the status was saved. */
async function revertStatus(run: RunDoc, status: "Draft" | "Finalised", err: unknown): Promise<never> {
  await PayrollRun.updateOne({ _id: run._id }, status === "Draft" ? { $set: { status }, $unset: { finalisedAt: 1, finalisedByName: 1 } } : { $set: { status } }).catch(() => {});
  throw err;
}

/**
 * { action: "adjust", line, otherEarnings?, otherDeductions?, tds?, remarks? }
 * | { action: "finalise" } | { action: "reopen", reason } | { action: "pay", paidOn, reference? }
 */
export async function payrollAction(id: string, body: Record<string, unknown>, user: SessionUser, req: Request) {
  const run = await loadRun(id);
  const action = String(body.action ?? "");
  const { monthIndex } = monthRange(run.month);
  let summary = "";
  switch (action) {
    case "adjust": {
      if (run.status !== "Draft") throw new ApiError(409, "Only draft payroll can be adjusted. Reopen it first.");
      const line = run.lines.find((l) => String(l._id) === String(body.line));
      if (!line) throw new ApiError(404, "Employee not found in this payroll");
      const parts: string[] = [];
      for (const k of ["otherEarnings", "otherDeductions", "tds"] as const) {
        if (!(k in body)) continue;
        const v = r2(num(body[k], 0));
        if (!(v >= 0 && v <= 10_000_000)) fail({ [k]: "Enter a valid amount" });
        if (v !== (line[k] ?? 0)) parts.push(`${k} ${money(line[k] ?? 0)} → ${money(v)}`);
        line[k] = v;
      }
      if ("remarks" in body) line.remarks = text(body.remarks, 200) || undefined;
      if ((line.otherEarnings ?? 0) > 0 || (line.otherDeductions ?? 0) > 0) {
        if (!line.remarks || line.remarks.length < 3) fail({ remarks: "Explain the extra earning / deduction" });
      }
      const advances = await activeAdvances([line.staff]);
      computeLine(line, monthIndex, advances.get(String(line.staff)) ?? []);
      if ((line.netPay ?? 0) < 0) fail({ otherDeductions: "Deductions cannot exceed the gross pay" });
      runTotals(run);
      summary = `Adjusted ${line.name} in payroll ${run.code}${parts.length ? `: ${parts.join(", ")}` : ""}; net ${money(line.netPay ?? 0)}`;
      break;
    }
    case "finalise": {
      if (run.status !== "Draft") throw new ApiError(409, `Payroll is already ${run.status.toLowerCase()}`);
      // Re-check advances: another run may have recovered from them since this draft was built.
      const advances = await activeAdvances(run.lines.map((l) => l.staff));
      for (const line of run.lines) computeLine(line, monthIndex, advances.get(String(line.staff)) ?? []);
      runTotals(run);
      run.status = "Finalised";
      run.finalisedAt = new Date();
      run.finalisedByName = user.name;
      await saveRun(run);
      await postRecoveries(run, 1).catch((err) => revertStatus(run, "Draft", err));
      const t = run.totals as Record<string, number>;
      await audit(req, user, run, `Finalised payroll ${run.code} (${run.month}): ${t.staff} employee(s), net ${money(t.net)}; advances recovered ${money(t.advance)}`);
      return getPayroll(id);
    }
    case "reopen": {
      if (run.status !== "Finalised") throw new ApiError(409, run.status === "Paid" ? "Salaries are already paid; this payroll cannot be reopened" : "Only finalised payroll can be reopened");
      const reason = text(body.reason, 300);
      if (reason.length < 3) fail({ reason: "Enter the reason for reopening" });
      run.status = "Draft";
      run.finalisedAt = undefined;
      run.finalisedByName = undefined;
      await saveRun(run);
      await postRecoveries(run, -1).catch((err) => revertStatus(run, "Finalised", err));
      await audit(req, user, run, `Reopened payroll ${run.code} (${run.month}); advance recoveries reversed. Reason: ${reason}`);
      return getPayroll(id);
    }
    case "pay": {
      if (run.status !== "Finalised") throw new ApiError(409, run.status === "Paid" ? "Already marked paid" : "Finalise the payroll before paying salaries");
      const paidOn = parseDay(body.paidOn);
      if (!paidOn) fail({ paidOn: "Enter the payment date" });
      if (paidOn > todayUtc()) fail({ paidOn: "Payment date cannot be in the future" });
      run.status = "Paid";
      run.paidOn = paidOn;
      run.paymentReference = text(body.reference, 60) || undefined;
      run.paidByName = user.name;
      summary = `Marked payroll ${run.code} (${run.month}) as paid on ${dayKey(paidOn)}${run.paymentReference ? `, ref ${run.paymentReference}` : ""}: net ${money((run.totals as Record<string, number>).net)}`;
      break;
    }
    default:
      throw new ApiError(400, "Unknown action");
  }
  await saveRun(run);
  await audit(req, user, run, summary);
  return getPayroll(id);
}

export async function deletePayroll(id: string, user: SessionUser, req: Request) {
  const run = await loadRun(id);
  if (run.status !== "Draft") throw new ApiError(409, "Only a draft payroll can be deleted");
  await PayrollRun.deleteOne({ _id: run._id });
  await audit(req, user, run, `Deleted draft payroll ${run.code} (${run.month})`, "delete");
  return { id };
}

/* ======================= reports ======================= */

export async function hrReports(url: URL) {
  const today = todayUtc();
  const from = parseDay(url.searchParams.get("from")) ?? new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const to = parseDay(url.searchParams.get("to")) ?? today;
  if (to < from) fail({ to: "End date cannot be before the start date" });
  if ((to.getTime() - from.getTime()) / DAY > 366) fail({ to: "Choose a period of at most one year" });
  const soon = (days: number) => new Date(today.getTime() + days * DAY);

  const [headcount, byCategory, joiners, leavers, registration, contracts, pendingLeaves, leaveTaken, payroll, onRolls] = await Promise.all([
    Staff().aggregate<{ _id: string; n: number; gross: number }>([{ $match: { status: { $in: WORKING_STATUSES } } }, { $group: { _id: "$department", n: { $sum: 1 }, gross: { $sum: { $ifNull: ["$salary", 0] } } } }, { $sort: { n: -1 } }]),
    Staff().aggregate<{ _id: string; n: number }>([{ $match: { status: { $in: WORKING_STATUSES } } }, { $group: { _id: "$staffCategory", n: { $sum: 1 } } }, { $sort: { n: -1 } }]),
    Staff().find({ joiningDate: { $gte: from, $lte: to } }).sort({ joiningDate: -1 }).limit(50).select("code fullName department designation joiningDate").lean<Doc[]>(),
    Staff().find({ exitDate: { $gte: from, $lte: to } }).sort({ exitDate: -1 }).limit(50).select("code fullName department designation exitDate status exitReason").lean<Doc[]>(),
    Staff().find({ status: { $in: WORKING_STATUSES }, registrationValidUntil: { $lte: soon(60) } }).sort({ registrationValidUntil: 1 }).limit(50).select("code fullName designation registrationNo registrationValidUntil").lean<Doc[]>(),
    Staff().find({ status: { $in: WORKING_STATUSES }, contractEndDate: { $lte: soon(30) } }).sort({ contractEndDate: 1 }).limit(50).select("code fullName designation employmentType contractEndDate").lean<Doc[]>(),
    Leaves().find({ status: "Pending" }).sort({ fromDate: 1 }).limit(50).populate({ path: "staff", select: "fullName code" }).lean<Doc[]>(),
    Leaves().aggregate<{ _id: string; days: number; n: number }>([{ $match: { status: "Approved", fromDate: { $lte: to }, toDate: { $gte: from } } }, { $group: { _id: "$leaveType", days: { $sum: "$days" }, n: { $sum: 1 } } }, { $sort: { days: -1 } }]),
    PayrollRun.find().sort({ month: -1 }).limit(12).select("code month status totals").lean(),
    Staff().countDocuments(onRollsFilter(to)),
  ]);

  // Attendance over the period: marks by status, plus late arrivals and overtime.
  const [marks] = await Attendance.aggregate<{ byStatus: { _id: string; n: number }[]; late: { n: number }[]; ot: { h: number }[] }>([
    { $match: { date: { $gte: from, $lte: to } } },
    { $facet: { byStatus: [{ $group: { _id: "$status", n: { $sum: 1 } } }], late: [{ $match: { lateMinutes: { $gt: 0 } } }, { $count: "n" }], ot: [{ $group: { _id: null, h: { $sum: "$overtimeHours" } } }] } },
  ]);
  const byStatus = Object.fromEntries((marks?.byStatus ?? []).map((s) => [s._id, s.n]));
  const workingMarks = (byStatus.Present ?? 0) + (byStatus["On Duty"] ?? 0) + (byStatus["Half Day"] ?? 0) * 0.5;
  const absentMarks = (byStatus.Absent ?? 0) + (byStatus["Half Day"] ?? 0) * 0.5;

  const staffLabel = (d: unknown) => (d && typeof d === "object" ? `${(d as Doc).fullName} (${(d as Doc).code ?? ""})` : "—");
  return {
    from: dayKey(from),
    to: dayKey(to),
    totals: {
      onRolls,
      joiners: joiners.length,
      leavers: leavers.length,
      attritionPct: onRolls ? r2((leavers.length / onRolls) * 100) : 0,
      monthlyGross: r2(headcount.reduce((s, h) => s + h.gross, 0)),
      attendancePct: workingMarks + absentMarks ? r2((workingMarks / (workingMarks + absentMarks)) * 100) : null,
      lateArrivals: marks?.late[0]?.n ?? 0,
      overtimeHours: r2(marks?.ot[0]?.h ?? 0),
      pendingLeaves: pendingLeaves.length,
    },
    attendance: Object.entries(byStatus).map(([label, n]) => ({ label, n })),
    headcount: headcount.map((h) => ({ label: h._id ?? "—", n: h.n, gross: r2(h.gross) })),
    byCategory: byCategory.map((c) => ({ label: c._id ?? "Not set", n: c.n })),
    leaveTaken: leaveTaken.map((l) => ({ label: l._id, days: r2(l.days), n: l.n })),
    joiners: joiners.map((s) => ({ id: String(s._id), code: s.code, name: s.fullName, department: s.department, designation: s.designation, date: isoOrNull(s.joiningDate) })),
    leavers: leavers.map((s) => ({ id: String(s._id), code: s.code, name: s.fullName, department: s.department, designation: s.designation, date: isoOrNull(s.exitDate), status: s.status, reason: s.exitReason ?? null })),
    registrations: registration.map((s) => ({ id: String(s._id), code: s.code, name: s.fullName, designation: s.designation, registrationNo: s.registrationNo ?? null, validUntil: isoOrNull(s.registrationValidUntil), expired: (s.registrationValidUntil as Date) < today })),
    contracts: contracts.map((s) => ({ id: String(s._id), code: s.code, name: s.fullName, designation: s.designation, employmentType: s.employmentType ?? null, endDate: isoOrNull(s.contractEndDate), ended: (s.contractEndDate as Date) < today })),
    pendingLeaves: pendingLeaves.map((l) => ({ id: String(l._id), code: l.code ?? null, staff: staffLabel(l.staff), leaveType: l.leaveType, from: isoOrNull(l.fromDate), to: isoOrNull(l.toDate), days: l.days ?? null })),
    payroll: payroll.map((p) => ({ id: String(p._id), code: p.code, month: p.month, status: p.status, totals: p.totals ?? null })),
  };
}

/** Nursing duty shifts of a staff member in a period (blocks leave approval). */
export async function rosteredShifts(staffId: unknown, from: Date, to: Date) {
  return Roster().find({ staff: staffId, status: { $in: ["Scheduled", "On Duty"] }, date: { $gte: from, $lte: to } }).select("date shift ward").sort({ date: 1 }).lean<Doc[]>();
}
