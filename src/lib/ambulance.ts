import "server-only";
import mongoose, { Types } from "mongoose";
import { chargeLines, isNight, tripCharges, type Tariff } from "./ambulance-math";
import { ApiError, escapeRegex, pagination, parsePaging } from "./api";
import { logActivity } from "./audit";
import { postAmbulanceCharges } from "./billing";
import { r2 } from "./billing-math";
import { WORKING_STATUSES, assertAvailable } from "./hr";
import { TRIP_TYPES } from "./modules";
import type { SessionUser } from "./session";
import { isObjectId } from "./validation";
import { ACTIVE_TRIP_STATUSES, BILLING_MODES, CREW_ROLES, TRIP_PRIORITIES, TRIP_STATUSES, Trip, type TripDoc } from "@/models/ambulance";
import { nextCode } from "@/models/Counter";
import { getRecordModel } from "@/models/records";
import { orgInfo } from "./org";

type Doc = Record<string, unknown> & { _id: Types.ObjectId };
type TDoc = mongoose.HydratedDocument<TripDoc>;

const model = (m: string, r: string) => getRecordModel(m, r)!;
const Vehicles = () => model("ambulance", "vehicles");
const Tariffs = () => model("ambulance", "tariffs");
const Fuel = () => model("ambulance", "fuel");
const Maintenance = () => model("ambulance", "maintenance");
const Staff = () => model("hr", "staff");
const Leaves = () => model("hr", "leaves");
const Patients = () => model("patients", "patients");
const Visits = () => model("opd_ipd", "visits");

const PHONE_RE = /^\+?[0-9][0-9\s-]{6,17}$/;
const DAY = 86_400_000;
const MAX_CREW = 4;
const COLLECT_MODES = ["Cash", "Card", "UPI", "Bank Transfer"] as const;
/** HR categories that can ride as crew. */
const CREW_CATEGORIES = ["Paramedic / EMT", "Nurse", "Doctor", "Support"];
const ACTIVE: TripDoc["status"][] = [...ACTIVE_TRIP_STATUSES];

/* ======================= helpers ======================= */

function todayUtc() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function parseDay(v: unknown): Date | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
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

function ageYears(dob: unknown) {
  if (!(dob instanceof Date)) return undefined;
  const now = new Date();
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const m = now.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < dob.getUTCDate())) age--;
  return Math.max(0, age);
}

const money = (n: number) => `₹${r2(n).toLocaleString("en-IN")}`;
const minutesBetween = (a?: Date | null, b?: Date | null) => (a instanceof Date && b instanceof Date ? Math.max(0, Math.round((b.getTime() - a.getTime()) / 60_000)) : null);

function plain(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (v instanceof Types.ObjectId) return String(v);
  if (Array.isArray(v)) return v.map(plain);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      if (k === "__v") continue;
      out[k === "_id" ? "id" : k] = plain(x);
    }
    return out;
  }
  return v;
}

async function loadTrip(id: string) {
  if (!isObjectId(id)) throw new ApiError(404, "Trip not found");
  const trip = await Trip.findById(id);
  if (!trip) throw new ApiError(404, "Trip not found");
  return trip as unknown as TDoc;
}

async function save(trip: TDoc) {
  try {
    await trip.save();
  } catch (err) {
    if (err instanceof mongoose.Error.VersionError) throw new ApiError(409, "This trip was just updated by someone else. Refresh and try again.");
    throw err;
  }
}

function audit(req: Request, user: SessionUser, trip: { _id: unknown; code: string }, summary: string, action: "create" | "update" = "update") {
  return logActivity({ req, user, action, module: "ambulance", resource: "trips", entityId: String(trip._id), entityLabel: trip.code, summary });
}

function event(trip: TDoc, status: string, user: SessionUser, note?: string) {
  trip.events.push({ at: new Date(), status, byName: user.name, note });
}

/** Compliance documents that block dispatch once expired. */
function expired(v: Doc, at = todayUtc()) {
  const checks: [string, string][] = [["insuranceExpiry", "insurance"], ["fitnessExpiry", "fitness certificate"], ["permitExpiry", "permit"]];
  return checks.filter(([k]) => v[k] instanceof Date && (v[k] as Date) < at).map(([, label]) => label);
}

/** Staff currently driving or crewing an active trip. */
async function busyStaff(exceptTrip?: unknown) {
  const trips = await Trip.find({ status: { $in: ACTIVE }, ...(exceptTrip ? { _id: { $ne: exceptTrip } } : {}) }).select("code driver crew.staff").lean();
  const out = new Map<string, string>();
  for (const t of trips) {
    if (t.driver) out.set(String(t.driver), t.code);
    for (const c of t.crew) if (c.staff) out.set(String(c.staff), t.code);
  }
  return out;
}

/* ======================= dispatch board ======================= */

export function tripRow(t: Record<string, unknown>) {
  const charges = t.charges as { total?: number } | undefined;
  return {
    id: String(t._id), code: t.code, requestedAt: (t.requestedAt as Date)?.toISOString(), tripType: t.tripType ?? "Emergency", priority: t.priority ?? "Urgent",
    patientName: t.patientName ?? null, patientCode: t.patientCode ?? null, patient: t.patient ? String(t.patient) : null, callerName: t.callerName ?? null, callerPhone: t.callerPhone,
    condition: t.condition ?? null, pickupLocation: t.pickupLocation, dropLocation: t.dropLocation ?? null, vehicleNumber: t.vehicleNumber ?? null, vehicleType: t.vehicleType ?? null,
    driverName: t.driverName ?? null, crew: ((t.crew as { name?: string }[]) ?? []).map((c) => c.name).filter(Boolean), status: t.status,
    dispatchedAt: (t.dispatchedAt as Date | undefined)?.toISOString() ?? null, onSceneAt: (t.onSceneAt as Date | undefined)?.toISOString() ?? null,
    distanceKm: t.distanceKm ?? null, total: charges?.total ?? null, paymentStatus: t.paymentStatus ?? "Not Billed", billCode: t.billCode ?? null,
  };
}

/** Live view: open calls, the fleet and who is free to crew. */
export async function board() {
  const today = todayUtc();
  const [open, vehicles, staff, busy, onLeave, todays] = await Promise.all([
    Trip.find({ status: { $in: ["Requested", ...ACTIVE] } }).sort({ requestedAt: 1 }).lean(),
    Vehicles().find({ status: { $ne: "Out of Service" } }).sort({ vehicleNumber: 1 }).lean<Doc[]>(),
    Staff()
      .find({ status: { $in: WORKING_STATUSES }, staffCategory: { $in: ["Driver", ...CREW_CATEGORIES] }, joiningDate: { $lte: today } })
      .sort({ fullName: 1 })
      .select("code fullName staffCategory phone designation")
      .lean<Doc[]>(),
    busyStaff(),
    Leaves().find({ status: "Approved", session: "Full day", fromDate: { $lte: today }, toDate: { $gte: today } }).select("staff").lean<Doc[]>(),
    Trip.find({ requestedAt: { $gte: today } }).select("status requestedAt dispatchedAt onSceneAt").lean(),
  ]);
  const leave = new Set(onLeave.map((l) => String(l.staff)));
  const tripOf = new Map(open.filter((t) => t.vehicle).map((t) => [String(t.vehicle), t]));
  const rank = (p: string) => TRIP_PRIORITIES.indexOf(p as (typeof TRIP_PRIORITIES)[number]);
  const response = todays.map((t) => minutesBetween(t.requestedAt, t.dispatchedAt)).filter((n): n is number => n !== null);
  const reach = todays.map((t) => minutesBetween(t.dispatchedAt, t.onSceneAt)).filter((n): n is number => n !== null);
  const avg = (a: number[]) => (a.length ? Math.round(a.reduce((s, x) => s + x, 0) / a.length) : null);
  return {
    open: open
      .sort((a, b) => (a.status === "Requested" ? 0 : 1) - (b.status === "Requested" ? 0 : 1) || rank(a.priority ?? "Urgent") - rank(b.priority ?? "Urgent") || a.requestedAt.getTime() - b.requestedAt.getTime())
      .map((t) => tripRow(t as unknown as Record<string, unknown>)),
    vehicles: vehicles.map((v) => {
      const trip = tripOf.get(String(v._id));
      return {
        id: String(v._id), vehicleNumber: String(v.vehicleNumber), type: String(v.type), status: String(v.status), equipment: v.equipment ? String(v.equipment).split(",") : [],
        defaultDriver: v.defaultDriver ? String(v.defaultDriver) : null, driverName: (v.driverName as string) ?? null, odometer: Number(v.odometer ?? 0), baseLocation: (v.baseLocation as string) ?? null,
        blocked: expired(v), trip: trip ? { id: String(trip._id), code: trip.code, status: trip.status } : null,
      };
    }),
    staff: staff.map((s) => ({
      id: String(s._id), code: (s.code as string) ?? "", name: String(s.fullName), category: String(s.staffCategory), phone: (s.phone as string) ?? "",
      onLeave: leave.has(String(s._id)), onTrip: busy.get(String(s._id)) ?? null,
    })),
    today: { calls: todays.length, completed: todays.filter((t) => t.status === "Completed").length, cancelled: todays.filter((t) => t.status === "Cancelled").length, avgResponseMin: avg(response), avgReachMin: avg(reach) },
  };
}

export async function listTrips(url: URL) {
  const { page, limit, skip } = parsePaging(url, 15);
  const filter: Record<string, unknown> = {};
  const q = text(url.searchParams.get("search"), 60);
  if (q) {
    const rx = new RegExp(escapeRegex(q), "i");
    filter.$or = [{ code: rx }, { patientName: rx }, { patientCode: rx }, { callerPhone: rx }, { callerName: rx }, { vehicleNumber: rx }, { pickupLocation: rx }, { dropLocation: rx }, { driverName: rx }];
  }
  const status = url.searchParams.get("status");
  if (status === "Active") filter.status = { $in: ACTIVE };
  else if (status && (TRIP_STATUSES as readonly string[]).includes(status)) filter.status = status;
  const type = url.searchParams.get("tripType");
  if (type && (TRIP_TYPES as readonly string[]).includes(type)) filter.tripType = type;
  const payment = url.searchParams.get("paymentStatus");
  if (payment) filter.paymentStatus = payment;
  const vehicle = url.searchParams.get("vehicle");
  if (isObjectId(vehicle)) filter.vehicle = new Types.ObjectId(vehicle);
  const patient = url.searchParams.get("patient");
  if (isObjectId(patient)) filter.patient = new Types.ObjectId(patient);
  const from = parseDay(url.searchParams.get("from"));
  const to = parseDay(url.searchParams.get("to"));
  if (from || to) filter.requestedAt = { ...(from ? { $gte: from } : {}), ...(to ? { $lt: new Date(to.getTime() + DAY) } : {}) };
  const [docs, total] = await Promise.all([Trip.find(filter).sort({ requestedAt: -1 }).skip(skip).limit(limit).lean(), Trip.countDocuments(filter)]);
  return { items: docs.map((d) => tripRow(d as unknown as Record<string, unknown>)), pagination: pagination(page, limit, total) };
}

/* ======================= create & dispatch ======================= */

/** Assign vehicle, driver and crew; claims the vehicle atomically. Returns a summary. */
async function applyDispatch(trip: TDoc, body: Record<string, unknown>, user: SessionUser) {
  if (trip.status !== "Requested") throw new ApiError(409, `Trip is already ${trip.status.toLowerCase()}`);
  if (!isObjectId(body.vehicle)) fail({ vehicle: "Select the vehicle" });
  const vehicle = await Vehicles().findById(body.vehicle).lean<Doc>();
  if (!vehicle) fail({ vehicle: "Vehicle not found" });
  const blocked = expired(vehicle);
  if (blocked.length) fail({ vehicle: `${vehicle.vehicleNumber}: ${blocked.join(", ")} expired` });
  if (vehicle.status !== "Available") fail({ vehicle: `${vehicle.vehicleNumber} is ${String(vehicle.status).toLowerCase()}` });
  const deadBody = trip.tripType === "Dead Body Transfer";
  if (deadBody !== (vehicle.type === "Mortuary Van")) fail({ vehicle: deadBody ? "Dead body transfers need a mortuary van" : "A mortuary van cannot carry patients" });

  const today = todayUtc();
  const busy = await busyStaff(trip._id);
  if (!isObjectId(body.driver)) fail({ driver: "Select the driver" });
  const driver = await Staff().findById(body.driver).lean<Doc>();
  if (!driver) fail({ driver: "Driver not found" });
  if (driver.staffCategory && driver.staffCategory !== "Driver") fail({ driver: `${driver.fullName} is not in the Driver category` });
  await assertAvailable(driver, today, "driver");
  if (busy.has(String(driver._id))) fail({ driver: `${driver.fullName} is on trip ${busy.get(String(driver._id))}` });

  const crewIn = (Array.isArray(body.crew) ? body.crew : []) as Record<string, unknown>[];
  if (crewIn.length > MAX_CREW) fail({ crew: `At most ${MAX_CREW} crew members` });
  const crew: { staff: Types.ObjectId; name: string; role: string; phone?: string }[] = [];
  for (const c of crewIn) {
    if (!isObjectId(c.staff)) fail({ crew: "Select each crew member" });
    if (String(c.staff) === String(driver._id) || crew.some((x) => String(x.staff) === String(c.staff))) fail({ crew: "Each person can be listed once" });
    const s = await Staff().findById(c.staff).lean<Doc>();
    if (!s) fail({ crew: "Crew member not found" });
    await assertAvailable(s, today, "crew");
    if (busy.has(String(s._id))) fail({ crew: `${s.fullName} is on trip ${busy.get(String(s._id))}` });
    const role = (CREW_ROLES as readonly string[]).includes(String(c.role)) ? String(c.role) : s.staffCategory === "Nurse" ? "Nurse" : s.staffCategory === "Doctor" ? "Doctor" : s.staffCategory === "Paramedic / EMT" ? "Paramedic / EMT" : "Attendant";
    crew.push({ staff: s._id, name: String(s.fullName), role, phone: (s.phone as string) ?? undefined });
  }
  if (trip.priority === "Critical" && !crew.length && !deadBody) fail({ crew: "Critical calls need at least one paramedic, nurse or doctor on board" });

  const odometer = Number(vehicle.odometer ?? 0);
  const start = body.odometerStart === undefined || body.odometerStart === "" ? odometer : r2(num(body.odometerStart));
  if (!(start >= 0)) fail({ odometerStart: "Enter the odometer reading" });
  if (start < odometer) fail({ odometerStart: `Below the vehicle's last reading (${odometer} km)` });

  // Claim the vehicle so two calls can never get the same ambulance.
  const claimed = await Vehicles().updateOne({ _id: vehicle._id, status: "Available" }, { $set: { status: "On Trip" } });
  if (claimed.modifiedCount === 0) fail({ vehicle: `${vehicle.vehicleNumber} was just taken by another call` });

  Object.assign(trip, {
    vehicle: vehicle._id, vehicleNumber: vehicle.vehicleNumber, vehicleType: vehicle.type,
    driver: driver._id, driverName: driver.fullName, driverPhone: driver.phone, crew, odometerStart: start,
    dispatchedAt: new Date(), status: "Dispatched",
  });
  event(trip, "Dispatched", user, `${vehicle.vehicleNumber} · ${driver.fullName}${crew.length ? ` + ${crew.map((c) => c.name).join(", ")}` : ""}`);
  return { vehicleId: vehicle._id, summary: `dispatched ${vehicle.vehicleNumber} with ${driver.fullName}${crew.length ? ` and ${crew.length} crew` : ""}` };
}

async function releaseVehicle(vehicleId: unknown, odometer?: number) {
  if (!vehicleId) return;
  await Vehicles().updateOne({ _id: vehicleId, status: "On Trip" }, { $set: { status: "Available" } });
  if (typeof odometer === "number") await Vehicles().updateOne({ _id: vehicleId, $or: [{ odometer: { $lt: odometer } }, { odometer: null }, { odometer: { $exists: false } }] }, { $set: { odometer } });
}

async function patientSnapshot(id: unknown, field = "patient") {
  if (!isObjectId(id)) fail({ [field]: "Select a registered patient" });
  const p = await Patients().findById(id).select("fullName code gender dateOfBirth").lean<Doc>();
  if (!p) fail({ [field]: "Patient not found" });
  return { patient: p._id, patientName: p.fullName, patientCode: p.code, patientGender: p.gender, patientAge: ageYears(p.dateOfBirth) };
}

export async function createTrip(body: Record<string, unknown>, user: SessionUser, req: Request) {
  const errors: Record<string, string> = {};
  const tripType = String(body.tripType ?? "Emergency");
  if (!(TRIP_TYPES as readonly string[]).includes(tripType)) errors.tripType = "Select the trip type";
  const priority = String(body.priority ?? "Urgent");
  if (!(TRIP_PRIORITIES as readonly string[]).includes(priority)) errors.priority = "Select the priority";
  const callerPhone = text(body.callerPhone, 20);
  if (!PHONE_RE.test(callerPhone)) errors.callerPhone = "Enter the caller's phone number";
  const pickupLocation = text(body.pickupLocation, 200);
  if (pickupLocation.length < 3) errors.pickupLocation = "Enter the pickup address";
  let requestedAt = new Date();
  if (body.requestedAt) {
    const d = new Date(String(body.requestedAt));
    if (Number.isNaN(d.getTime())) errors.requestedAt = "Enter a valid date and time";
    else if (d.getTime() > Date.now() + 5 * 60_000 && tripType !== "Scheduled Pickup" && tripType !== "Event Standby") errors.requestedAt = "Call time cannot be in the future";
    else requestedAt = d;
  }
  const age = body.patientAge === "" || body.patientAge === undefined || body.patientAge === null ? undefined : Math.floor(num(body.patientAge));
  if (age !== undefined && !(age >= 0 && age <= 120)) errors.patientAge = "Enter a valid age";
  if (Object.keys(errors).length) fail(errors);

  const who = body.patient ? await patientSnapshot(body.patient) : { patientName: text(body.patientName, 120) || undefined, patientAge: age, patientGender: text(body.patientGender, 10) || undefined };
  const trip = new Trip({
    code: "pending", tripType, priority, callerName: text(body.callerName, 120) || undefined, callerPhone, requestedAt, ...who,
    condition: text(body.condition, 500) || undefined, pickupLocation, pickupLandmark: text(body.pickupLandmark, 120) || undefined,
    dropLocation: text(body.dropLocation, 200) || (body.toHospital !== false ? orgInfo().name : undefined), toHospital: body.toHospital !== false, notes: text(body.notes, 500) || undefined,
    status: "Requested", createdBy: user.id, updatedBy: user.id, createdByName: user.name,
  }) as unknown as TDoc;
  event(trip, "Requested", user, `${tripType} · ${priority}${trip.condition ? ` · ${trip.condition}` : ""}`);

  let dispatched: { vehicleId: unknown; summary: string } | null = null;
  const dispatch = body.dispatch && typeof body.dispatch === "object" ? (body.dispatch as Record<string, unknown>) : null;
  if (dispatch?.vehicle) dispatched = await applyDispatch(trip, dispatch, user);
  try {
    trip.code = await nextCode("AMB");
    await save(trip);
  } catch (err) {
    if (dispatched) await releaseVehicle(dispatched.vehicleId);
    throw err;
  }
  await audit(req, user, trip, `Logged ${priority.toLowerCase()} ${tripType.toLowerCase()} call ${trip.code} from ${callerPhone} at ${pickupLocation}${dispatched ? `; ${dispatched.summary}` : ""}`, "create");
  return getTrip(String(trip._id));
}

/* ======================= read ======================= */

async function tariffFor(vehicleType?: string | null, tripType?: string | null) {
  if (!vehicleType) return null;
  const T = Tariffs();
  return (
    (await T.findOne({ status: "Active", vehicleType, tripType }).lean<Doc>()) ??
    (await T.findOne({ status: "Active", vehicleType, $or: [{ tripType: null }, { tripType: { $exists: false } }] }).lean<Doc>())
  );
}

function tariffOut(t: Doc | null): (Tariff & { id: string }) | null {
  if (!t) return null;
  const n = (k: string) => (typeof t[k] === "number" ? (t[k] as number) : null);
  return {
    id: String(t._id), name: String(t.name), baseFare: n("baseFare") ?? 0, includedKm: n("includedKm"), perKmRate: n("perKmRate") ?? 0, freeWaitingMinutes: n("freeWaitingMinutes"),
    waitingPerHour: n("waitingPerHour"), nightSurchargePct: n("nightSurchargePct"), oxygenCharge: n("oxygenCharge"), ventilatorCharge: n("ventilatorCharge"),
  };
}

export async function getTrip(id: string) {
  const trip = await loadTrip(id);
  const out = plain(trip.toObject()) as Record<string, unknown>;
  const vehicle = trip.vehicle ? await Vehicles().findById(trip.vehicle).select("odometer status equipment").lean<Doc>() : null;
  return {
    ...out,
    tariff: trip.status === "Completed" || trip.status === "Cancelled" ? null : tariffOut(await tariffFor(trip.vehicleType, trip.tripType)),
    vehicleOdometer: vehicle ? Number(vehicle.odometer ?? 0) : null,
    night: trip.dispatchedAt ? isNight(trip.dispatchedAt) : isNight(trip.requestedAt),
    hospital: (({ name, address, phone, logo }) => ({ name, address, phone, logo }))(orgInfo()),
    timings: {
      responseMin: minutesBetween(trip.requestedAt, trip.dispatchedAt),
      reachMin: minutesBetween(trip.dispatchedAt, trip.onSceneAt),
      sceneMin: minutesBetween(trip.onSceneAt, trip.departedAt),
      transportMin: minutesBetween(trip.departedAt, trip.arrivedAt),
      totalMin: minutesBetween(trip.requestedAt, trip.completedAt ?? trip.arrivedAt),
    },
  };
}

/* ======================= actions ======================= */

function paymentStatusOf(total: number, paid: number) {
  if (paid <= 0) return "Unpaid";
  return paid + 0.005 >= total ? "Paid" : "Partially Paid";
}

function parsePayment(raw: unknown, balance: number) {
  const p = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!p || p.amount === undefined || p.amount === "" || p.amount === null) return null;
  const amount = r2(num(p.amount));
  const mode = String(p.mode ?? "");
  const reference = text(p.reference, 60);
  if (!(COLLECT_MODES as readonly string[]).includes(mode)) fail({ mode: "Select the payment mode" });
  if (!(amount > 0)) fail({ amount: "Enter the amount received" });
  if (amount > balance + 0.005) fail({ amount: balance > 0 ? `Only ${money(balance)} is due` : "Nothing is due on this trip" });
  if ((mode === "Bank Transfer" || mode === "Card" || mode === "UPI") && !reference) fail({ reference: "Enter the transaction reference" });
  return { mode, amount, reference: reference || undefined };
}

/**
 * { action: "dispatch", vehicle, driver, crew: [{ staff, role }], odometerStart? }
 * | "on-scene" | "transport" | { action: "arrive", registerVisit? } | { action: "complete", … }
 * | { action: "pay", mode, amount, reference? } | { action: "update", … } | { action: "cancel", reason }
 */
export async function tripAction(id: string, body: Record<string, unknown>, user: SessionUser, req: Request) {
  const trip = await loadTrip(id);
  const action = String(body.action ?? "");
  const step = (from: string[], to: string, field: "onSceneAt" | "departedAt" | "arrivedAt") => {
    if (!from.includes(trip.status)) throw new ApiError(409, `Trip is ${trip.status.toLowerCase()}`);
    trip.status = to as TDoc["status"];
    trip[field] = new Date();
    event(trip, to, user, text(body.note, 200) || undefined);
  };
  let summary = "";
  let release: { vehicle: unknown; odometer?: number } | null = null;

  switch (action) {
    case "dispatch": {
      const { vehicleId, summary: s } = await applyDispatch(trip, body, user);
      summary = `Trip ${trip.code}: ${s}`;
      try {
        await save(trip);
      } catch (err) {
        await releaseVehicle(vehicleId);
        throw err;
      }
      await audit(req, user, trip, summary);
      return getTrip(id);
    }
    case "on-scene":
      step(["Dispatched"], "On Scene", "onSceneAt");
      summary = `Trip ${trip.code}: ${trip.vehicleNumber} reached the pickup`;
      break;
    case "transport":
      if (trip.tripType === "Event Standby") throw new ApiError(409, "Standby duty has no patient transport; complete the trip instead");
      step(["On Scene"], "Transporting", "departedAt");
      summary = `Trip ${trip.code}: patient on board, leaving for ${trip.dropLocation ?? "the hospital"}`;
      break;
    case "arrive": {
      step(["Transporting"], "Arrived", "arrivedAt");
      summary = `Trip ${trip.code}: reached ${trip.dropLocation ?? "the hospital"}`;
      if (body.registerVisit === true) {
        if (!trip.patient) fail({ registerVisit: "Link the registered patient to open an emergency visit" });
        if (!trip.toHospital) fail({ registerVisit: "The patient is not being brought to this hospital" });
        if (!trip.visit) {
          const visit = await Visits().create({
            code: await nextCode("OPD"), patient: trip.patient, visitDate: todayUtc(), department: "Emergency", complaint: [trip.condition, `Brought by ambulance ${trip.code}`].filter(Boolean).join(" — ").slice(0, 1000),
            status: "Waiting", createdBy: user.id, updatedBy: user.id,
          });
          trip.visit = visit._id as Types.ObjectId;
          trip.visitCode = String(visit.get("code"));
          summary += `; emergency visit ${trip.visitCode} opened`;
        }
      }
      break;
    }
    case "update": {
      if (trip.status === "Completed" || trip.status === "Cancelled") throw new ApiError(409, `Trip is ${trip.status.toLowerCase()}`);
      const parts: string[] = [];
      if (body.patient) {
        if (trip.bill) throw new ApiError(409, "Charges are already on a bill");
        Object.assign(trip, await patientSnapshot(body.patient));
        parts.push(`patient → ${trip.patientName} (${trip.patientCode})`);
      }
      for (const [k, max] of [["condition", 500], ["dropLocation", 200], ["notes", 500]] as const) {
        if (k in body) {
          trip.set(k, text(body[k], max) || undefined);
          parts.push(k);
        }
      }
      if ("toHospital" in body) {
        trip.toHospital = body.toHospital === true;
        parts.push("destination");
      }
      if (!parts.length) throw new ApiError(400, "Nothing to update");
      event(trip, trip.status, user, `Updated ${parts.join(", ")}`);
      summary = `Updated trip ${trip.code}: ${parts.join(", ")}`;
      break;
    }
    case "complete": {
      if (!ACTIVE.includes(trip.status)) throw new ApiError(409, trip.status === "Requested" ? "Dispatch the trip first" : `Trip is ${trip.status.toLowerCase()}`);
      const errors: Record<string, string> = {};
      const start = trip.odometerStart ?? r2(num(body.odometerStart));
      const end = r2(num(body.odometerEnd));
      if (!(start >= 0)) errors.odometerStart = "Enter the starting odometer reading";
      if (!(end >= 0)) errors.odometerEnd = "Enter the closing odometer reading";
      else if (end < start) errors.odometerEnd = `Cannot be below the starting reading (${start} km)`;
      else if (end - start > 2000) errors.odometerEnd = "More than 2,000 km for one trip — check the reading";
      const waitingMinutes = Math.max(0, Math.round(num(body.waitingMinutes, 0)));
      if (!(waitingMinutes <= 2880)) errors.waitingMinutes = "Enter the waiting time in minutes";
      const billingMode = String(body.billingMode ?? "");
      if (!(BILLING_MODES as readonly string[]).includes(billingMode)) errors.billingMode = "Choose how the trip is charged";
      if (billingMode === "Hospital Bill" && !trip.patient) errors.billingMode = "Link the registered patient to add charges to their hospital bill";
      const discount = r2(num(body.discount, 0));
      if (!(discount >= 0)) errors.discount = "Enter a valid discount";
      const reason = text(body.discountReason, 200);
      if ((discount > 0 || billingMode === "No Charge") && reason.length < 3) errors.discountReason = billingMode === "No Charge" ? "Enter why the trip is free" : "Enter the reason for the discount";
      if (Object.keys(errors).length) fail(errors);

      const distanceKm = r2(end - start);
      Object.assign(trip, { odometerStart: start, odometerEnd: end, distanceKm, waitingMinutes, oxygenUsed: body.oxygenUsed === true, ventilatorUsed: body.ventilatorUsed === true, billingMode, discountReason: reason || undefined });
      const parts = [`${distanceKm} km`];
      if (billingMode === "No Charge") {
        trip.charges = { base: 0, distance: 0, waiting: 0, night: 0, equipment: 0, discount: 0, total: 0 };
        trip.paymentStatus = "No Charge";
        parts.push(`no charge (${reason})`);
      } else {
        const tariffDoc = await tariffFor(trip.vehicleType, trip.tripType);
        const tariff = tariffOut(tariffDoc);
        if (!tariff) throw new ApiError(422, `No active ambulance tariff for ${trip.vehicleType}. Add one under Ambulance → Tariffs.`);
        const charges = tripCharges(tariff, { distanceKm, waitingMinutes, night: isNight(trip.dispatchedAt ?? trip.requestedAt), oxygen: trip.oxygenUsed === true, ventilator: trip.ventilatorUsed === true, discount });
        if (discount > charges.total + charges.discount) fail({ discount: "Discount cannot exceed the charges" });
        trip.charges = charges;
        trip.tariff = tariffDoc!._id;
        trip.tariffName = tariff.name;
        parts.push(`charges ${money(charges.total)}`);
        if (billingMode === "Hospital Bill") {
          if (charges.total > 0) {
            const patient = await Patients().findById(trip.patient).lean<Doc>();
            if (!patient) fail({ billingMode: "Patient not found" });
            const bill = await postAmbulanceCharges(
              { patient, tripId: trip._id, tripCode: trip.code, billType: trip.tripType === "Emergency" ? "Emergency" : "OPD", lines: chargeLines(charges, { name: tariff.name, distanceKm }) },
              user,
              req
            );
            trip.bill = bill.id;
            trip.billCode = bill.code;
            parts.push(`added to bill ${bill.code}`);
          }
          trip.paymentStatus = "On Hospital Bill";
        } else {
          const pay = parsePayment(body.payment, charges.total);
          if (pay) {
            trip.payments.push({ ...pay, at: new Date(), byName: user.name });
            trip.paidAmount = pay.amount;
            parts.push(`collected ${money(pay.amount)} (${pay.mode})`);
          }
          trip.paymentStatus = charges.total > 0 ? paymentStatusOf(charges.total, trip.paidAmount ?? 0) : "Paid";
        }
      }
      trip.status = "Completed";
      trip.completedAt = new Date();
      event(trip, "Completed", user, parts.join(" · "));
      release = { vehicle: trip.vehicle, odometer: end };
      summary = `Completed trip ${trip.code}: ${parts.join(", ")}`;
      break;
    }
    case "pay": {
      if (trip.billingMode !== "Collect" || trip.status !== "Completed") throw new ApiError(409, "Payments are collected on completed trips charged directly");
      const total = trip.charges?.total ?? 0;
      const pay = parsePayment(body, r2(total - (trip.paidAmount ?? 0)));
      if (!pay) fail({ amount: "Enter the amount received" });
      trip.payments.push({ ...pay, at: new Date(), byName: user.name });
      trip.paidAmount = r2((trip.paidAmount ?? 0) + pay.amount);
      trip.paymentStatus = paymentStatusOf(total, trip.paidAmount);
      event(trip, trip.status, user, `Payment ${money(pay.amount)} (${pay.mode})`);
      summary = `Collected ${money(pay.amount)} (${pay.mode}) on trip ${trip.code}; ${trip.paymentStatus.toLowerCase()}`;
      break;
    }
    case "cancel": {
      if (trip.status === "Completed" || trip.status === "Cancelled") throw new ApiError(409, `Trip is already ${trip.status.toLowerCase()}`);
      const reason = text(body.reason, 300);
      if (reason.length < 3) fail({ reason: "Enter the reason for cancelling" });
      if (trip.status !== "Requested") release = { vehicle: trip.vehicle };
      trip.status = "Cancelled";
      trip.cancelledAt = new Date();
      trip.cancelReason = reason;
      event(trip, "Cancelled", user, reason);
      summary = `Cancelled trip ${trip.code}${trip.vehicleNumber ? ` (${trip.vehicleNumber} released)` : ""}. Reason: ${reason}`;
      break;
    }
    default:
      throw new ApiError(400, "Unknown action");
  }

  trip.updatedBy = new Types.ObjectId(user.id);
  await save(trip);
  if (release) await releaseVehicle(release.vehicle, release.odometer);
  await audit(req, user, trip, summary);
  return getTrip(id);
}

/* ======================= reports ======================= */

export async function ambulanceReports(url: URL) {
  const today = todayUtc();
  const from = parseDay(url.searchParams.get("from")) ?? new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const to = parseDay(url.searchParams.get("to")) ?? today;
  if (to < from) fail({ to: "End date cannot be before the start date" });
  const end = new Date(to.getTime() + DAY);
  const soon = new Date(today.getTime() + 30 * DAY);

  const [trips, fuel, service, vehicles] = await Promise.all([
    Trip.find({ requestedAt: { $gte: from, $lt: end } }).select("code requestedAt dispatchedAt onSceneAt completedAt status tripType priority vehicle vehicleNumber driver driverName distanceKm charges paidAmount billingMode cancelReason").lean(),
    Fuel().aggregate<{ _id: Types.ObjectId; litres: number; cost: number }>([{ $match: { fillDate: { $gte: from, $lte: to } } }, { $group: { _id: "$vehicle", litres: { $sum: "$litres" }, cost: { $sum: "$amount" } } }]),
    Maintenance().aggregate<{ _id: Types.ObjectId; cost: number; jobs: number }>([{ $match: { startDate: { $gte: from, $lte: to }, status: { $ne: "Cancelled" } } }, { $group: { _id: "$vehicle", cost: { $sum: { $ifNull: ["$cost", 0] } }, jobs: { $sum: 1 } } }]),
    Vehicles().find().sort({ vehicleNumber: 1 }).lean<Doc[]>(),
  ]);
  const done = trips.filter((t) => t.status === "Completed");
  const avg = (a: (number | null)[]) => {
    const xs = a.filter((n): n is number => n !== null);
    return xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : null;
  };
  const group = <K extends string>(rows: typeof trips, key: (t: (typeof trips)[number]) => K) => {
    const m = new Map<K, typeof trips>();
    for (const t of rows) m.set(key(t), [...(m.get(key(t)) ?? []), t]);
    return m;
  };
  const km = (rows: typeof trips) => r2(rows.reduce((s, t) => s + (t.distanceKm ?? 0), 0));
  const revenue = (rows: typeof trips) => r2(rows.reduce((s, t) => s + (t.charges?.total ?? 0), 0));
  const fuelBy = new Map(fuel.map((f) => [String(f._id), f]));
  const serviceBy = new Map(service.map((s) => [String(s._id), s]));
  const byVehicle = group(done, (t) => String(t.vehicle ?? ""));
  const totalLitres = r2(fuel.reduce((s, f) => s + f.litres, 0));

  const daily = new Map<string, { trips: number; km: number }>();
  for (const t of trips) {
    const k = t.requestedAt.toISOString().slice(0, 10);
    const d = daily.get(k) ?? { trips: 0, km: 0 };
    d.trips++;
    d.km = r2(d.km + (t.distanceKm ?? 0));
    daily.set(k, d);
  }
  const alertsFor = (v: Doc) =>
    (
      [
        ["insuranceExpiry", "Insurance"],
        ["fitnessExpiry", "Fitness"],
        ["pucExpiry", "PUC"],
        ["permitExpiry", "Permit"],
        ["nextServiceDue", "Service"],
      ] as const
    )
      .filter(([k]) => v[k] instanceof Date && (v[k] as Date) <= soon)
      .map(([k, label]) => ({ label, date: (v[k] as Date).toISOString(), overdue: (v[k] as Date) < today }));

  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    totals: {
      calls: trips.length,
      completed: done.length,
      cancelled: trips.filter((t) => t.status === "Cancelled").length,
      km: km(done),
      revenue: revenue(done),
      collected: r2(done.reduce((s, t) => s + (t.paidAmount ?? 0), 0)),
      onBills: revenue(done.filter((t) => t.billingMode === "Hospital Bill")),
      uncollected: r2(done.filter((t) => t.billingMode === "Collect").reduce((s, t) => s + Math.max(0, (t.charges?.total ?? 0) - (t.paidAmount ?? 0)), 0)),
      avgResponseMin: avg(trips.map((t) => minutesBetween(t.requestedAt, t.dispatchedAt))),
      avgReachMin: avg(trips.map((t) => minutesBetween(t.dispatchedAt, t.onSceneAt))),
      avgCycleMin: avg(done.map((t) => minutesBetween(t.requestedAt, t.completedAt))),
      fuelLitres: totalLitres,
      fuelCost: r2(fuel.reduce((s, f) => s + f.cost, 0)),
      serviceCost: r2(service.reduce((s, x) => s + x.cost, 0)),
      kmPerLitre: totalLitres ? r2(km(done) / totalLitres) : null,
    },
    byType: [...group(trips, (t) => t.tripType ?? "Emergency")].map(([label, rows]) => ({ label, n: rows.length, km: km(rows), revenue: revenue(rows.filter((t) => t.status === "Completed")) })),
    byPriority: [...group(trips, (t) => t.priority ?? "Urgent")].map(([label, rows]) => ({ label, n: rows.length, avgResponseMin: avg(rows.map((t) => minutesBetween(t.requestedAt, t.dispatchedAt))) })),
    byVehicle: vehicles.map((v) => {
      const rows = byVehicle.get(String(v._id)) ?? [];
      const f = fuelBy.get(String(v._id));
      const kms = km(rows);
      return {
        id: String(v._id), vehicleNumber: String(v.vehicleNumber), type: String(v.type), status: String(v.status), trips: rows.length, km: kms, revenue: revenue(rows),
        litres: r2(f?.litres ?? 0), fuelCost: r2(f?.cost ?? 0), kmPerLitre: f?.litres ? r2(kms / f.litres) : null, serviceCost: r2(serviceBy.get(String(v._id))?.cost ?? 0), odometer: Number(v.odometer ?? 0),
      };
    }),
    byDriver: [...group(done.filter((t) => t.driver), (t) => t.driverName ?? "—")].map(([label, rows]) => ({ label, trips: rows.length, km: km(rows) })).sort((a, b) => b.trips - a.trips),
    daily: [...daily].sort(([a], [b]) => a.localeCompare(b)).map(([date, d]) => ({ date, ...d })),
    compliance: vehicles.map((v) => ({ id: String(v._id), vehicleNumber: String(v.vehicleNumber), alerts: alertsFor(v) })).filter((v) => v.alerts.length),
    cancellations: trips.filter((t) => t.status === "Cancelled").slice(0, 30).map((t) => ({ id: String(t._id), code: t.code, at: t.requestedAt.toISOString(), reason: t.cancelReason ?? "—" })),
  };
}

/** Trips of one patient (patient page). */
export async function patientTrips(patientId: Types.ObjectId) {
  const [docs, total] = await Promise.all([Trip.find({ patient: patientId }).sort({ requestedAt: -1 }).limit(10).lean(), Trip.countDocuments({ patient: patientId })]);
  return { total, items: docs.map((d) => tripRow(d as unknown as Record<string, unknown>)) };
}
