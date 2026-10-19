import "server-only";
import mongoose, { Types } from "mongoose";
import { ApiError, escapeRegex, pagination, parsePaging } from "./api";
import { logActivity } from "./audit";
import { approvedLeaves, leaveOn, minutesOf, todayUtc } from "./hr";
import type { SessionUser } from "./session";
import { isObjectId } from "./validation";
import { BiometricDevice, BiometricPunch, DEVICE_STATUSES } from "@/models/biometric";
import { Attendance, PayrollRun } from "@/models/hr";
import { getRecordModel } from "@/models/records";

/**
 * Biometric attendance. Machines speaking the ZKTeco / eSSL "ADMS" push
 * protocol (Menu → Comm → Cloud Server) call /iclock/* on this server; their
 * log files can also be imported. Each punch is matched to the employee whose
 * Biometric ID equals the machine's user ID, and the day's first and last
 * punch become the in / out time on the attendance register.
 */

type Doc = Record<string, unknown> & { _id: Types.ObjectId };
type DeviceDoc = mongoose.HydratedDocument<mongoose.InferSchemaType<typeof BiometricDevice.schema>>;
interface RawPunch {
  pin: string;
  at: Date;
  verifyMode?: string;
  state?: string;
}

const Staff = () => getRecordModel("hr", "staff")!;
const DAY = 86_400_000;
/** Unknown machines are listed for approval; more than this many waiting is noise. */
const MAX_PENDING_DEVICES = 20;
const MAX_LINES = 50_000;
/** Punches this close together are one punch pressed twice. */
const DOUBLE_TAP_MS = 5 * 60_000;
/** A night shift's morning punches up to this long after it ends belong to the shift's start day. */
const NIGHT_SPILL_MIN = 240;

const VERIFY_MODES: Record<string, string> = { "0": "Password", "1": "Fingerprint", "2": "Card", "3": "Password", "4": "Card", "15": "Face", "25": "Palm" };
const STATES: Record<string, string> = { "0": "Check-in", "1": "Check-out", "2": "Break-out", "3": "Break-in", "4": "OT-in", "5": "OT-out" };

const dayKey = (d: Date) => d.toISOString().slice(0, 10);
const hhmm = (d: Date) => d.toISOString().slice(11, 16);
/** "2026-10-19 09:02:11" — punch times are wall-clock (see models/biometric.ts). */
const wallStamp = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");
const startOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

function fail(errors: Record<string, string>, message = "Please correct the highlighted fields"): never {
  throw new ApiError(422, message, errors);
}

function text(v: unknown, max: number) {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function parseDay(v: unknown): Date | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) || dayKey(d) !== v ? null : d;
}

/** Machines store user IDs with or without leading zeros ("0042" / "42"); match them as the same person. */
export function normalizePin(v: unknown) {
  const s = String(v ?? "").trim().replace(/^"|"$/g, "");
  if (!/^[A-Za-z0-9]{1,24}$/.test(s)) return null;
  return /^\d+$/.test(s) ? s.replace(/^0+(?=\d)/, "") : s.toUpperCase();
}

/** "2026-10-19 09:02:11", "2026/10/19 09:02" or "19-10-2026 09:02" → wall-clock Date. */
function parseWallClock(raw: string): Date | null {
  const s = raw.trim().replace(/^"|"$/g, "");
  const iso = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  const dmy = iso ? null : s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!iso && !dmy) return null;
  const [y, mo, d, h, mi, se] = (iso ? [iso[1], iso[2], iso[3], iso[4], iso[5], iso[6]] : [dmy![3], dmy![2], dmy![1], dmy![4], dmy![5], dmy![6]]).map((x) => Number(x ?? 0));
  if (h > 23 || mi > 59 || se > 59) return null;
  const t = new Date(Date.UTC(y, mo - 1, d, h, mi, se));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d ? t : null;
}

/** Device clocks are sometimes wrong; ignore punches from before 2000 or more than a day ahead. */
function plausible(at: Date) {
  return at.getUTCFullYear() >= 2000 && at.getTime() <= Date.now() + 2 * DAY;
}

/** ATTLOG body sent by a machine: PIN \t YYYY-MM-DD HH:MM:SS \t state \t verify \t … per line. */
function parseAttlog(body: string): RawPunch[] {
  const out: RawPunch[] = [];
  for (const line of body.split(/\r?\n/).slice(0, MAX_LINES)) {
    const f = line.split("\t");
    const pin = normalizePin(f[0]);
    const at = f[1] ? parseWallClock(f[1]) : null;
    if (!pin || !at || !plausible(at)) continue;
    out.push({ pin, at, state: STATES[f[2]?.trim()] ?? undefined, verifyMode: VERIFY_MODES[f[3]?.trim()] ?? (f[3]?.trim() ? "Other" : undefined) });
  }
  return out;
}

/**
 * Exported log files: the machine's attlog.dat (tab separated, as above) or a
 * CSV with the user ID first and the date-time next — in one column or as
 * separate date and time columns. Header and unreadable lines are skipped.
 */
function parseImport(body: string) {
  const punches: RawPunch[] = [];
  let skipped = 0;
  const lines = body.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length > MAX_LINES) fail({ file: `At most ${MAX_LINES.toLocaleString("en-IN")} lines per file` });
  for (const line of lines) {
    const tabbed = line.includes("\t");
    const f = line.split(tabbed ? "\t" : /[,;]/).map((x) => x.trim());
    const pin = normalizePin(f[0]);
    const joined = f[1] && f[2] ? parseWallClock(`${f[1]} ${f[2]}`) : null;
    const at = (f[1] ? parseWallClock(f[1]) : null) ?? joined;
    if (!pin || !at || !plausible(at)) {
      skipped++;
      continue;
    }
    const rest = joined && !parseWallClock(f[1]) ? f.slice(3) : f.slice(2);
    punches.push({ pin, at, state: tabbed ? STATES[rest[0]] : undefined, verifyMode: tabbed ? VERIFY_MODES[rest[1]] : undefined });
  }
  return { punches, skipped };
}

/* ======================= matching ======================= */

interface StaffMatch {
  staff: Doc | null;
  note?: string;
}

/** Employees by normalised Biometric ID; an ID entered on two employees matches neither. */
async function staffByPin() {
  const rows = await Staff()
    .find({ biometricId: { $nin: [null, ""] } })
    .select("code fullName biometricId shift joiningDate exitDate status")
    .populate({ path: "shift", select: "startTime endTime graceMinutes" })
    .lean<Doc[]>();
  const map = new Map<string, Doc[]>();
  for (const s of rows) {
    const pin = normalizePin(s.biometricId);
    if (pin) map.set(pin, [...(map.get(pin) ?? []), s]);
  }
  return (pin: string): StaffMatch => {
    const found = map.get(pin) ?? [];
    if (found.length === 1) return { staff: found[0] };
    if (found.length > 1) return { staff: null, note: `Biometric ID ${pin} is entered on ${found.map((s) => s.fullName).join(" and ")}` };
    return { staff: null, note: `No employee has Biometric ID ${pin}` };
  };
}

function shiftOf(staff: Doc | null) {
  return staff?.shift && typeof staff.shift === "object" ? (staff.shift as Doc) : null;
}

/** The attendance day a punch counts towards. */
function workDateOf(at: Date, staff: Doc | null) {
  const day = startOfDay(at);
  const shift = shiftOf(staff);
  const start = minutesOf(shift?.startTime);
  const end = minutesOf(shift?.endTime);
  if (start !== null && end !== null && end < start) {
    // Night shift (e.g. 20:00–08:00): the morning punch-out belongs to the evening the shift began.
    const mins = at.getUTCHours() * 60 + at.getUTCMinutes();
    if (mins <= Math.min(end + NIGHT_SPILL_MIN, start - 60)) return new Date(day.getTime() - DAY);
  }
  return day;
}

/* ======================= ingest ======================= */

/** Store new punches (duplicates are ignored) and bring the attendance of the affected days up to date. */
async function ingest(raws: RawPunch[], source: "Device" | "Import", device: DeviceDoc | null) {
  if (!raws.length) return { received: 0, inserted: 0, duplicates: 0, applied: 0, unmatched: 0 };
  const match = await staffByPin();
  const docs = raws.map((r) => {
    const m = match(r.pin);
    return {
      pin: r.pin, punchAt: r.at, workDate: workDateOf(r.at, m.staff), staff: m.staff?._id, staffName: m.staff ? String(m.staff.fullName) : undefined,
      staffCode: (m.staff?.code as string | undefined) ?? undefined, device: device?._id, deviceSerial: device?.serialNo, deviceName: device?.name || device?.serialNo,
      verifyMode: r.verifyMode, state: r.state, source, note: m.note,
    };
  });
  const res = await BiometricPunch.bulkWrite(
    docs.map((d) => ({ updateOne: { filter: { pin: d.pin, punchAt: d.punchAt }, update: { $setOnInsert: d }, upsert: true } })),
    { ordered: false }
  );
  const fresh = Object.keys(res.upsertedIds ?? {}).map((i) => docs[Number(i)]);
  const pairs = fresh.filter((d) => d.staff).map((d) => ({ staff: d.staff as Types.ObjectId, date: d.workDate }));
  const { applied } = await applyDays(pairs);
  if (device && fresh.length) {
    const last = fresh.reduce((a, d) => (d.punchAt > a ? d.punchAt : a), fresh[0].punchAt);
    await BiometricDevice.updateOne({ _id: device._id }, { $inc: { punchCount: fresh.length }, $max: { lastPunchAt: last } });
  }
  return { received: raws.length, inserted: fresh.length, duplicates: raws.length - fresh.length, applied, unmatched: fresh.filter((d) => !d.staff).length };
}

/**
 * Recompute the biometric attendance mark of each (employee, day) from all of
 * that day's punches. A day is left alone — and its punches say why — when
 * the employee was not on the rolls, is on approved full-day leave, the
 * month's payroll is finalised, or someone marked the day by hand.
 */
async function applyDays(input: { staff: Types.ObjectId; date: Date }[]) {
  const pairs = [...new Map(input.map((p) => [`${p.staff}|${dayKey(p.date)}`, p])).values()];
  if (!pairs.length) return { applied: 0, skipped: 0 };
  const staffIds = [...new Set(pairs.map((p) => String(p.staff)))].map((id) => new Types.ObjectId(id));
  const dates = pairs.map((p) => p.date.getTime());
  const from = new Date(Math.min(...dates));
  const to = new Date(Math.max(...dates));
  const months = [...new Set(pairs.map((p) => dayKey(p.date).slice(0, 7)))];

  const [staffRows, punches, marks, leaves, locked] = await Promise.all([
    Staff().find({ _id: { $in: staffIds } }).select("fullName joiningDate exitDate shift").populate({ path: "shift", select: "startTime endTime graceMinutes" }).lean<Doc[]>(),
    BiometricPunch.find({ staff: { $in: staffIds }, workDate: { $gte: from, $lte: to } }).sort({ punchAt: 1 }).select("staff workDate punchAt deviceName").lean(),
    Attendance.find({ staff: { $in: staffIds }, date: { $gte: from, $lte: to } }).select("staff date source").lean(),
    approvedLeaves(staffIds, from, to),
    PayrollRun.find({ month: { $in: months }, status: { $in: ["Finalised", "Paid"] } }).select("code month").lean(),
  ]);
  const staffMap = new Map(staffRows.map((s) => [String(s._id), s]));
  const key = (staff: unknown, d: Date) => `${staff}|${dayKey(d)}`;
  const byDay = new Map<string, typeof punches>();
  for (const p of punches) byDay.set(key(p.staff, p.workDate!), [...(byDay.get(key(p.staff, p.workDate!)) ?? []), p]);
  const markMap = new Map(marks.map((m) => [key(m.staff, m.date), m]));
  const lockedMonths = new Map(locked.map((r) => [r.month, r.code]));
  const latest = new Date(todayUtc().getTime() + DAY);

  const attendanceOps: mongoose.AnyBulkWriteOperation[] = [];
  const noteOps: mongoose.AnyBulkWriteOperation[] = [];
  let applied = 0;
  for (const p of pairs) {
    const s = staffMap.get(String(p.staff));
    const dayPunches = byDay.get(key(p.staff, p.date)) ?? [];
    if (!s || !dayPunches.length) continue;
    const leave = leaveOn(leaves.get(String(p.staff)), p.date);
    const mark = markMap.get(key(p.staff, p.date));
    const lockCode = lockedMonths.get(dayKey(p.date).slice(0, 7));
    let note: string | null = null;
    if (p.date > latest) note = "Punch is dated in the future; check the machine's clock";
    else if ((s.joiningDate instanceof Date && s.joiningDate > p.date) || (s.exitDate instanceof Date && s.exitDate < p.date)) note = "Employee was not on the rolls on this date";
    else if (lockCode) note = `Payroll ${lockCode} is finalised; attendance is locked`;
    else if (leave && leave.session === "Full day") note = `On approved leave ${leave.code ?? ""}`.trim();
    else if (mark && mark.source !== "Biometric") note = "Marked by hand in the register; kept as entered";

    noteOps.push({ updateMany: { filter: { staff: p.staff, workDate: p.date }, update: note ? { $set: { note } } : { $unset: { note: "" } } } });
    if (note) continue;

    const first = dayPunches[0].punchAt;
    const last = dayPunches[dayPunches.length - 1].punchAt;
    const hasOut = last.getTime() - first.getTime() >= DOUBLE_TAP_MS;
    const shift = shiftOf(s);
    const start = minutesOf(shift?.startTime);
    const end = minutesOf(shift?.endTime);
    const shiftMinutes = start !== null && end !== null ? (end > start ? end - start : end + 1440 - start) : null;
    const workedMinutes = hasOut ? (last.getTime() - first.getTime()) / 60_000 : null;
    const status = leave || (shiftMinutes && workedMinutes !== null && workedMinutes < shiftMinutes / 2) ? "Half Day" : "Present";
    const inMin = first.getUTCHours() * 60 + first.getUTCMinutes();
    const late = start !== null ? Math.max(0, inMin - start - Number(shift?.graceMinutes ?? 0)) : 0;
    const devices = [...new Set(dayPunches.map((x) => x.deviceName).filter(Boolean))].join(", ");
    attendanceOps.push({
      updateOne: {
        filter: { staff: p.staff, date: p.date },
        update: {
          $set: { status, inTime: hhmm(first), outTime: hasOut ? hhmm(last) : undefined, lateMinutes: late, punches: dayPunches.length, source: "Biometric", markedByName: devices ? `Biometric · ${devices}` : "Biometric" },
          $unset: { markedBy: "" },
          $setOnInsert: { staff: p.staff, date: p.date, overtimeHours: 0 },
        },
        upsert: true,
      },
    });
    applied++;
  }
  if (attendanceOps.length) await Attendance.bulkWrite(attendanceOps, { ordered: false });
  if (noteOps.length) await BiometricPunch.bulkWrite(noteOps, { ordered: false });
  return { applied, skipped: pairs.length - applied };
}

/* ======================= device protocol (/iclock) ======================= */

/** Records that a machine called in; unknown machines are added as Pending for HR to approve. */
export async function deviceCheckIn(serialNo: string, ip: string) {
  let device = (await BiometricDevice.findOne({ serialNo })) as DeviceDoc | null;
  if (!device) {
    if ((await BiometricDevice.countDocuments({ status: "Pending" })) >= MAX_PENDING_DEVICES) return null;
    try {
      device = (await BiometricDevice.create({ serialNo, status: "Pending", lastSeenAt: new Date(), lastIp: ip })) as DeviceDoc;
    } catch (err) {
      if ((err as { code?: number }).code !== 11000) throw err;
      device = (await BiometricDevice.findOne({ serialNo })) as DeviceDoc | null;
    }
    return device;
  }
  // Machines poll every few seconds; refresh "last seen" at most once a minute.
  if (!device.lastSeenAt || Date.now() - device.lastSeenAt.getTime() > 60_000 || device.lastIp !== ip) {
    await BiometricDevice.updateOne({ _id: device._id }, { $set: { lastSeenAt: new Date(), lastIp: ip } });
  }
  return device;
}

/** Handshake reply: what the machine should upload and how often. */
export function deviceOptions(device: DeviceDoc) {
  const tz = process.env.BIOMETRIC_TIMEZONE?.trim();
  return [
    `GET OPTION FROM: ${device.serialNo}`,
    `ATTLOGStamp=${device.attlogStamp || "None"}`,
    // Operation logs (enrolments, menu use) and photos are not needed.
    "OPERLOGStamp=9999",
    "ATTPHOTOStamp=9999",
    "ErrorDelay=30",
    "Delay=10",
    "TransTimes=00:00;14:05",
    "TransInterval=1",
    "TransFlag=TransData AttLog",
    "Realtime=1",
    "Encrypt=None",
    ...(tz && /^-?\d{1,2}(\.\d+)?$/.test(tz) ? [`TimeZone=${tz}`] : []),
  ].join("\n");
}

/** ATTLOG upload from a machine. Returns how many lines were accepted. */
export async function receiveAttlog(device: DeviceDoc, body: string, stamp: string | null) {
  const raws = parseAttlog(body);
  await ingest(raws, "Device", device);
  if (stamp && /^\d{1,20}$/.test(stamp)) await BiometricDevice.updateOne({ _id: device._id }, { $set: { attlogStamp: stamp } });
  return raws.length;
}

/* ======================= HR screens ======================= */

function deviceOut(d: Record<string, unknown>) {
  return {
    id: String(d._id), serialNo: d.serialNo, name: d.name ?? null, location: d.location ?? null, status: d.status,
    lastSeenAt: d.lastSeenAt instanceof Date ? d.lastSeenAt.toISOString() : null, lastIp: d.lastIp ?? null,
    lastPunchAt: d.lastPunchAt instanceof Date ? wallStamp(d.lastPunchAt) : null, punchCount: d.punchCount ?? 0, approvedByName: d.approvedByName ?? null,
  };
}

export async function listDevices() {
  const today = todayUtc();
  const [devices, todayPunches, unmatched, problems] = await Promise.all([
    BiometricDevice.find().sort({ status: 1, name: 1, serialNo: 1 }).lean(),
    BiometricPunch.countDocuments({ punchAt: { $gte: today, $lt: new Date(today.getTime() + DAY) } }),
    BiometricPunch.countDocuments({ staff: null, punchAt: { $gte: new Date(today.getTime() - 30 * DAY) } }),
    BiometricPunch.countDocuments({ staff: { $ne: null }, note: { $nin: [null, ""] }, punchAt: { $gte: new Date(today.getTime() - 30 * DAY) } }),
  ]);
  return {
    devices: devices.map((d) => deviceOut(d as Record<string, unknown>)),
    stats: { todayPunches, unmatched, notApplied: problems },
    timezone: process.env.BIOMETRIC_TIMEZONE?.trim() || null,
  };
}

/** Register a machine by serial number, or update one: { id?, serialNo, name, location, status }. */
export async function saveDevice(body: Record<string, unknown>, user: SessionUser, req: Request) {
  const name = text(body.name, 60);
  const location = text(body.location, 80);
  const status = String(body.status ?? "");
  if (status && !(DEVICE_STATUSES as readonly string[]).includes(status)) fail({ status: "Invalid status" });
  if (status === "Pending") fail({ status: "Choose Active or Disabled" });
  if (!name) fail({ name: "Name the machine, e.g. Main gate" });

  let device: DeviceDoc | null;
  if (body.id) {
    device = isObjectId(body.id) ? ((await BiometricDevice.findById(body.id)) as DeviceDoc | null) : null;
    if (!device) throw new ApiError(404, "Device not found");
  } else {
    const serialNo = text(body.serialNo, 40).toUpperCase();
    if (!/^[A-Z0-9_-]{4,40}$/.test(serialNo)) fail({ serialNo: "Enter the serial number shown under Menu → System Info" });
    device = ((await BiometricDevice.findOne({ serialNo })) as DeviceDoc | null) ?? (new BiometricDevice({ serialNo }) as DeviceDoc);
  }
  const was = device.isNew ? null : device.status;
  device.name = name;
  device.location = location || undefined;
  device.status = (status || "Active") as DeviceDoc["status"];
  if (device.status === "Active" && was !== "Active") device.approvedByName = user.name;
  await device.save();
  await logActivity({
    req, user, action: was ? "update" : "create", module: "hr", resource: "biometric_devices", entityId: String(device._id), entityLabel: device.serialNo,
    summary: `${was === null ? "Registered" : was === "Pending" && device.status === "Active" ? "Approved" : "Updated"} biometric machine ${name} (${device.serialNo})${device.status !== "Active" ? ` — ${device.status.toLowerCase()}` : ""}`,
  });
  return deviceOut(device.toObject() as Record<string, unknown>);
}

/** Punch log: ?date=YYYY-MM-DD&search=&filter=unmatched|not-applied&page= */
export async function listPunches(url: URL) {
  const { page, limit, skip } = parsePaging(url, 50);
  const date = parseDay(url.searchParams.get("date")) ?? todayUtc();
  const filter: Record<string, unknown> = { punchAt: { $gte: date, $lt: new Date(date.getTime() + DAY) } };
  const kind = url.searchParams.get("filter");
  if (kind === "unmatched") filter.staff = null;
  if (kind === "not-applied") Object.assign(filter, { staff: { $ne: null }, note: { $nin: [null, ""] } });
  const q = text(url.searchParams.get("search"), 60);
  if (q) {
    const rx = new RegExp(escapeRegex(q), "i");
    filter.$or = [{ staffName: rx }, { staffCode: rx }, { pin: normalizePin(q) ?? q }];
  }
  const [rows, total] = await Promise.all([BiometricPunch.find(filter).sort({ punchAt: -1 }).skip(skip).limit(limit).lean(), BiometricPunch.countDocuments(filter)]);
  return {
    items: rows.map((p) => ({
      id: String(p._id), pin: p.pin, at: wallStamp(p.punchAt), workDate: p.workDate ? dayKey(p.workDate) : null, staffId: p.staff ? String(p.staff) : null,
      staffName: p.staffName ?? null, staffCode: p.staffCode ?? null, device: p.deviceName ?? null, verifyMode: p.verifyMode ?? null, state: p.state ?? null, source: p.source, note: p.note ?? null,
    })),
    pagination: pagination(page, limit, total),
  };
}

/** Upload of an exported log file: { text, fileName? }. */
export async function importLog(body: Record<string, unknown>, user: SessionUser, req: Request) {
  const content = typeof body.text === "string" ? body.text : "";
  if (!content.trim()) fail({ file: "The file is empty" });
  const { punches, skipped } = parseImport(content);
  if (!punches.length) fail({ file: "No punches found. Each line needs the user ID followed by the date and time." });
  const result = await ingest(punches, "Import", null);
  const fileName = text(body.fileName, 120);
  await logActivity({
    req, user, action: "create", module: "hr", resource: "biometric_punches", entityLabel: fileName || "log file",
    summary: `Imported biometric log${fileName ? ` ${fileName}` : ""}: ${result.inserted} new punch(es), ${result.duplicates} already received, ${result.unmatched} unmatched, ${result.applied} attendance day(s) updated`,
  });
  return { ...result, skipped };
}

/**
 * Match punches again (after Biometric IDs were added or corrected) and
 * re-apply them for { from, to } — at most 62 days.
 */
export async function reprocess(body: Record<string, unknown>, user: SessionUser, req: Request) {
  const from = parseDay(body.from);
  const to = parseDay(body.to);
  if (!from) fail({ from: "Select the start date" });
  if (!to) fail({ to: "Select the end date" });
  if (from > to) fail({ to: "End date must be on or after the start date" });
  if (to.getTime() - from.getTime() > 61 * DAY) fail({ to: "Re-apply at most 62 days at a time" });

  const match = await staffByPin();
  const punches = await BiometricPunch.find({ punchAt: { $gte: from, $lt: new Date(to.getTime() + DAY) } }).select("pin punchAt staff workDate").lean();
  const ops: mongoose.AnyBulkWriteOperation[] = [];
  const pairs: { staff: Types.ObjectId; date: Date }[] = [];
  let rematched = 0;
  for (const p of punches) {
    const m = match(p.pin);
    const workDate = workDateOf(p.punchAt, m.staff);
    if (String(m.staff?._id ?? "") !== String(p.staff ?? "")) rematched++;
    ops.push({
      updateOne: {
        filter: { _id: p._id },
        update: m.staff
          ? { $set: { staff: m.staff._id, staffName: String(m.staff.fullName), staffCode: m.staff.code, workDate }, $unset: { note: "" } }
          : { $set: { workDate, note: m.note }, $unset: { staff: "", staffName: "", staffCode: "" } },
      },
    });
    if (m.staff) pairs.push({ staff: m.staff._id, date: workDate });
  }
  if (ops.length) await BiometricPunch.bulkWrite(ops, { ordered: false });
  const { applied, skipped } = await applyDays(pairs);
  await logActivity({
    req, user, action: "update", module: "hr", resource: "biometric_punches", entityLabel: `${dayKey(from)} – ${dayKey(to)}`,
    summary: `Re-applied biometric punches ${dayKey(from)} to ${dayKey(to)}: ${punches.length} punch(es), ${rematched} re-matched, ${applied} day(s) updated, ${skipped} kept as they were`,
  });
  return { punches: punches.length, rematched, applied, skipped, unmatched: punches.length - pairs.length };
}
