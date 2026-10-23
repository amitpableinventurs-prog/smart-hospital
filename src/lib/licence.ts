import "server-only";
import { randomUUID } from "node:crypto";
import os from "node:os";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { ApiError } from "./api";
import { logActivity } from "./audit";
import { connectDB } from "./db";
import { APP_VERSION, appMode, controlUrl } from "./deployment";
import type { Branding, LicencePayload, LicenceView, RenewalInfo, RenewalOrder } from "./licence-protocol";
import { isModuleKey } from "./modules";
import { isOfflineKey, verifyOfflineKey } from "./offline-licence";
import { setOrgBranding } from "./org";
import type { SessionUser } from "./session";
import { resetSync, runSync } from "./sync";
import { isValidEmail } from "./validation";
import { Licence, type LicenceDoc } from "@/models/licence";
import { User } from "@/models/User";

/**
 * Client installations: the licence from the Control Panel decides which
 * modules exist here and whether the app may be used. The app works offline;
 * it checks in every few minutes when it can and locks only when the vendor
 * suspends it, the licence expires, or it has been offline for longer than
 * the grace period.
 */

const DAY = 86_400_000;
const CHECK_EVERY_MS = 10 * 60_000;
const VIEW_CACHE_MS = 15_000;
const TIMEOUT_MS = 20_000;

declare global {
  var __licenceView: { at: number; view: LicenceView } | undefined;
  var __clientJobs: boolean | undefined;
}

const APP_NAME = "MediCare";

const unlicensed = (mode: LicenceView["mode"]): LicenceView => ({
  mode, hospitalName: process.env.HOSPITAL_NAME || null, clientCode: null, locked: null, modules: null, notice: null, expiresAt: null, lastCheckAt: null,
  offlineDaysLeft: null, offlineDays: null, expiresInDays: null, lastError: null, plan: null, trial: false, maxUsers: null, offline: false, vendor: null,
  brand: { appName: APP_NAME, color: null, logoVersion: null },
});

const brandingOf = (lic: { branding?: unknown } | null) => (lic?.branding && typeof lic.branding === "object" ? (lic.branding as Branding) : null);

function viewOf(lic: (LicenceDoc & { lastCheckAt?: Date | null }) | null): LicenceView {
  if (!lic) return { ...unlicensed("client"), hospitalName: null, locked: { reason: "not_activated", message: "This installation has not been activated yet." } };
  const offline = !!lic.offline;
  // An offline licence never checks the time with the server: never count from before the latest time seen.
  const now = offline ? Math.max(Date.now(), lic.clockAt?.getTime() ?? 0) : Date.now();
  const lastCheck = lic.lastCheckAt ?? lic.activatedAt ?? null;
  const offlineDays = offline ? 0 : lastCheck ? (now - lastCheck.getTime()) / DAY : Infinity;
  const graceDays = lic.graceDays ?? 15;
  let locked: LicenceView["locked"] = null;
  if (offline) {
    if (lic.expiresAt && lic.expiresAt.getTime() < now) {
      locked = { reason: "expired", message: `Your ${lic.trial ? "trial " : ""}licence key expired on ${lic.expiresAt.toISOString().slice(0, 10)}. Enter a new key from your vendor to continue — your data is kept.` };
    }
  } else if (lic.status === "Deactivated") locked = { reason: "deactivated", message: "This installation was deactivated by your vendor. Activate it again with a licence key." };
  else if (lic.status === "Suspended") locked = { reason: "suspended", message: lic.notice || "Your licence is suspended. Please contact your vendor." };
  else if (lic.expiresAt && lic.expiresAt.getTime() < now) {
    locked = lic.trial
      ? { reason: "expired", message: `Your free trial ended on ${lic.expiresAt.toISOString().slice(0, 10)}. Choose a plan to keep using the app — your data is kept.` }
      : { reason: "expired", message: `Your licence expired on ${lic.expiresAt.toISOString().slice(0, 10)}. Renew your plan to continue.` };
  }
  else if (offlineDays > graceDays) locked = { reason: "offline", message: `This computer has not reached the licence server for ${Math.floor(offlineDays)} days (allowed: ${graceDays}). Connect it to the internet and press "Check again".` };
  return {
    mode: "client", hospitalName: lic.hospitalName, clientCode: lic.clientCode, locked, modules: (lic.modules ?? []).filter(isModuleKey), notice: lic.notice ?? null,
    expiresAt: lic.expiresAt?.toISOString() ?? null, lastCheckAt: lastCheck?.toISOString() ?? null,
    offlineDaysLeft: offline ? null : Number.isFinite(offlineDays) ? Math.max(0, Math.ceil(graceDays - offlineDays)) : 0, offlineDays: offline ? null : Number.isFinite(offlineDays) ? Math.floor(offlineDays) : null,
    expiresInDays: lic.expiresAt ? Math.ceil((lic.expiresAt.getTime() - now) / DAY) : null, lastError: lic.lastError ?? null,
    plan: lic.planCode ? { code: lic.planCode, name: lic.planName ?? lic.planCode } : null, trial: !!lic.trial, maxUsers: lic.maxUsers ?? 0, offline,
    vendor: (lic.vendor as LicenceView["vendor"]) ?? null,
    brand: { appName: brandingOf(lic)?.appName || APP_NAME, color: brandingOf(lic)?.color ?? null, logoVersion: brandingOf(lic)?.logo ? (lic.brandingAt?.toISOString() ?? "1") : null },
  };
}

/** The licence as it applies right now. Cheap: cached for a few seconds. */
export async function licenceView(): Promise<LicenceView> {
  const mode = appMode();
  if (mode !== "client") return unlicensed(mode);
  const cached = globalThis.__licenceView;
  if (cached && Date.now() - cached.at < VIEW_CACHE_MS) return cached.view;
  await connectDB();
  startClientJobs();
  const lic = await Licence.findById("licence").lean();
  if (lic?.offline && Date.now() - (lic.clockAt?.getTime() ?? 0) > 3_600_000) {
    lic.clockAt = new Date();
    await Licence.updateOne({ _id: "licence", $or: [{ clockAt: null }, { clockAt: { $lt: lic.clockAt } }] }, { clockAt: lic.clockAt });
  }
  const view = viewOf(lic);
  setOrgBranding(lic?.hospitalName ?? null, brandingOf(lic), lic?.brandingAt?.toISOString() ?? null);
  globalThis.__licenceView = { at: Date.now(), view };
  return view;
}

function forgetView() {
  globalThis.__licenceView = undefined;
}

/** Apply what the Control Panel says; returns true when it asked for a full re-upload. */
function apply(lic: mongoose.HydratedDocument<LicenceDoc>, p: LicencePayload) {
  lic.set({
    clientCode: p.clientCode, hospitalName: p.hospitalName, status: p.status === "Suspended" ? "Suspended" : "Active", modules: (p.modules ?? []).filter(isModuleKey),
    expiresAt: p.expiresAt ? new Date(p.expiresAt) : null, graceDays: p.graceDays, syncEnabled: p.syncEnabled, notice: p.notice || undefined, domain: p.domain || undefined,
    planCode: p.plan?.code || undefined, planName: p.plan?.name || undefined, trial: !!p.trial, maxUsers: p.maxUsers ?? 0, vendor: p.vendor ?? undefined,
  });
  // Branding is only sent when it changed (and on activation).
  if (p.branding !== undefined) lic.set({ branding: p.branding ?? undefined, brandingAt: p.brandingAt ? new Date(p.brandingAt) : undefined });
  const resync = p.resyncRequestedAt ? new Date(p.resyncRequestedAt) : null;
  if (resync && (!lic.resyncRequestedAt || resync > lic.resyncRequestedAt)) {
    lic.resyncRequestedAt = resync;
    return true;
  }
  return false;
}

async function localStats() {
  const db = mongoose.connection.db!;
  const count = (name: string) => db.collection(name).estimatedDocumentCount().catch(() => 0);
  const [users, patients, bills, visits, admissions, staff, stats] = await Promise.all([
    count("users"), count("patients"), count("billing_bills"), count("opd_ipd_visits"), count("opd_ipd_admissions"), count("hr_staff"), db.stats().catch(() => null),
  ]);
  return { users, patients, bills, visits, admissions, staff, dataMB: stats ? Math.round((Number(stats.dataSize) / 1_048_576) * 10) / 10 : null, platform: `${os.platform()} ${os.release()}` };
}

async function callControl(path: string, body: unknown, token?: string) {
  const url = controlUrl();
  if (!url) throw new ApiError(503, "CONTROL_URL is not set for this installation.");
  let res: Response;
  try {
    res = await fetch(`${url}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    throw new ApiError(503, `Cannot reach the licence server (${url}). Check the internet connection.`);
  }
  const json = (await res.json().catch(() => null)) as { success?: boolean; data?: unknown; error?: { message?: string; fields?: Record<string, string> } } | null;
  if (!res.ok || !json?.success) throw new ApiError(res.status >= 400 ? res.status : 502, json?.error?.message ?? `Licence server error (HTTP ${res.status})`, json?.error?.fields);
  return json.data;
}

let checking: Promise<{ ok: boolean; error?: string }> | null = null;

/** Check in with the Control Panel and refresh the licence. Never throws. */
export function checkIn() {
  checking ??= (async () => {
    if (appMode() !== "client") return { ok: true };
    await connectDB();
    const lic = await Licence.findById("licence").select("+installToken");
    if (!lic) return { ok: false, error: "Not activated" };
    // Nothing to ask the Control Panel: the key itself is the licence.
    if (lic.offline) {
      forgetView();
      return { ok: true };
    }
    let result: { ok: boolean; error?: string } = { ok: true };
    let resync = false;
    try {
      const payload = (await callControl("/api/control/heartbeat", { version: APP_VERSION, host: os.hostname(), stats: await localStats(), brandingAt: lic.branding ? (lic.brandingAt?.toISOString() ?? null) : null }, lic.installToken ?? undefined)) as LicencePayload;
      resync = apply(lic, payload);
      lic.lastCheckAt = new Date();
      lic.lastError = undefined;
    } catch (err) {
      const e = err as ApiError;
      // The vendor reset this installation (or moved the licence to another computer).
      if (e.status === 401) lic.status = "Deactivated";
      lic.lastError = e.message;
      result = { ok: false, error: e.message };
    }
    lic.lastAttemptAt = new Date();
    await lic.save();
    if (resync) await resetSync();
    forgetView();
    return result;
  })().finally(() => {
    checking = null;
  });
  return checking;
}

/** Background check-in and upload, started by the first request after the server starts. */
export function startClientJobs() {
  if (globalThis.__clientJobs || appMode() !== "client") return;
  globalThis.__clientJobs = true;
  const tick = async () => {
    try {
      await checkIn();
      const view = await licenceView();
      if (view.locked?.reason !== "not_activated" && view.locked?.reason !== "deactivated") {
        const r = await runSync();
        if (r.errors.length) console.warn("[sync]", r.errors.slice(0, 3).join("; "));
      }
    } catch (err) {
      console.error("[licence] background job failed:", err);
    }
  };
  setTimeout(tick, 3_000);
  setInterval(tick, CHECK_EVERY_MS).unref?.();
}

/** Whether activation should also create the hospital's super admin. */
export async function activationNeeds() {
  await connectDB();
  const lic = await Licence.findById("licence").select("status").lean();
  return {
    canActivate: appMode() === "client" && (!lic || lic.status === "Deactivated"),
    needsAdmin: !(await User.exists({ role: "super_admin" })),
    controlUrl: controlUrl() || null,
  };
}

/**
 * { licenceKey, admin?: { name, email, password } } — binds this computer to
 * the licence. Needs the internet once; afterwards the app runs offline.
 * An offline key (SH1.…) activates without the internet at all.
 */
export async function activate(body: Record<string, unknown>, req: Request) {
  if (appMode() !== "client") throw new ApiError(404, "Not a client installation");
  const needs = await activationNeeds();
  if (!needs.canActivate) throw new ApiError(409, "This installation is already activated.");
  const licenceKey = typeof body.licenceKey === "string" ? body.licenceKey.trim() : "";
  const errors: Record<string, string> = {};
  if (!licenceKey) errors.licenceKey = "Enter the licence key from your vendor";
  const { name, email, password } = needs.needsAdmin ? adminErrors((body.admin && typeof body.admin === "object" ? body.admin : {}) as Record<string, unknown>, errors) : { name: "", email: "", password: "" };
  if (Object.keys(errors).length) throw new ApiError(422, Object.values(errors)[0], errors);

  const installationId = await installationIdOf();
  if (isOfflineKey(licenceKey)) return finishActivation(offlineData(licenceKey), installationId, needs.needsAdmin ? { name, email, password } : null, req, "Activated offline licence key");
  const data = (await callControl("/api/control/activate", { licenceKey, installationId, host: os.hostname(), version: APP_VERSION })) as { licence: LicencePayload; installToken: string };
  return finishActivation(data, installationId, needs.needsAdmin ? { name, email, password } : null, req, "Activated licence");
}

/** The licence in an offline key, shaped like an activation by the Control Panel. */
function offlineData(licenceKey: string): ActivationData {
  const k = verifyOfflineKey(licenceKey);
  if (k.expiresAt && Date.parse(k.expiresAt) < Date.now()) throw new ApiError(422, `This key expired on ${k.expiresAt.slice(0, 10)}. Ask your vendor for a new one.`, { licenceKey: "This key has expired" });
  return {
    offlineKeyId: k.id,
    licence: {
      clientCode: k.code, hospitalName: k.hospital, status: "Active", modules: k.modules, expiresAt: k.expiresAt, graceDays: 0, syncEnabled: false, notice: null, domain: null,
      resyncRequestedAt: null, serverTime: new Date().toISOString(), plan: k.plan, trial: k.trial, maxUsers: k.maxUsers, brandingAt: null, vendor: null,
    },
  };
}

/**
 * Super admin, once activated: { licenceKey } — renews or changes the licence with
 * a new offline key from the vendor (also while the app is locked, and to move an
 * installation that cannot reach the Control Panel to an offline licence).
 */
export async function enterOfflineKey(body: Record<string, unknown>, user: SessionUser, req: Request) {
  if (appMode() !== "client") throw new ApiError(404, "Not a client installation");
  const licenceKey = typeof body.licenceKey === "string" ? body.licenceKey.trim() : "";
  if (!isOfflineKey(licenceKey)) throw new ApiError(422, "Paste the offline licence key from your vendor (it starts with SH1.)", { licenceKey: "Paste the whole key, starting with SH1." });
  const data = offlineData(licenceKey);
  await connectDB();
  const current = await Licence.findById("licence").select("offlineKeyId").lean();
  if (current?.offlineKeyId === data.offlineKeyId) throw new ApiError(409, "This key is already in use here.", { licenceKey: "This key is already in use here" });
  return finishActivation(data, await installationIdOf(), null, req, "Entered offline licence key", user);
}

async function installationIdOf() {
  const existing = await Licence.findById("licence").lean();
  return existing?.installationId ?? randomUUID();
}

function adminErrors(admin: Record<string, unknown>, errors: Record<string, string>) {
  const name = typeof admin.name === "string" ? admin.name.trim() : "";
  const email = typeof admin.email === "string" ? admin.email.trim().toLowerCase() : "";
  const password = typeof admin.password === "string" ? admin.password : "";
  if (name.length < 2) errors["admin.name"] = "Enter the administrator's name";
  if (!isValidEmail(email)) errors["admin.email"] = "Enter a valid email";
  if (password.length < 8) errors["admin.password"] = "Use at least 8 characters";
  return { name, email, password };
}

type ActivationData = { licence: LicencePayload; installToken?: string; offlineKeyId?: string };

/** Saves the licence the Control Panel (or an offline key) issued and, on a fresh install, creates the hospital's super admin. */
async function finishActivation(data: ActivationData, installationId: string, admin: { name: string; email: string; password: string } | null, req: Request, what: string, by?: SessionUser) {
  const { name, email, password } = admin ?? { name: "", email: "", password: "" };
  const now = new Date();
  const previous = await Licence.findById("licence").select("branding brandingAt vendor clockAt").lean();
  await Licence.deleteOne({ _id: "licence" });
  const offline = !!data.offlineKeyId;
  const lic = new Licence({
    _id: "licence", clientCode: data.licence.clientCode, hospitalName: data.licence.hospitalName, installationId, installToken: data.installToken, activatedAt: now, lastCheckAt: now, lastAttemptAt: now,
    offline, offlineKeyId: data.offlineKeyId, clockAt: offline ? new Date(Math.max(now.getTime(), previous?.clockAt?.getTime() ?? 0)) : undefined,
  });
  apply(lic, data.licence);
  // An offline key carries no branding or vendor details: keep what the Control Panel sent before.
  if (offline && previous) lic.set({ branding: previous.branding, brandingAt: previous.brandingAt, vendor: previous.vendor });
  await lic.save();
  let created = null;
  if (admin) {
    created = await User.create({ name, email, passwordHash: await bcrypt.hash(password, 12), role: "super_admin", modules: [], active: true });
  }
  forgetView();
  await logActivity({
    req, user: created ? { id: String(created._id), name: created.name, email: created.email, role: "super_admin" } : (by ?? null), actorEmail: email || undefined,
    action: "create", module: "system", resource: "licence", entityLabel: data.licence.clientCode,
    summary: `${what} ${data.licence.clientCode} for ${data.licence.hospitalName} on ${os.hostname()}${created ? `; created administrator ${email}` : ""}`,
  });
  return { hospitalName: data.licence.hospitalName, createdAdmin: !!created };
}

/**
 * Setup without a licence key: { hospital: { hospitalName, contactName, phone, email, city?, referralCode? }, admin? }.
 * The Control Panel starts the free trial plan for this computer; returns the licence key it issued (shown once).
 */
export async function startTrial(body: Record<string, unknown>, req: Request) {
  if (appMode() !== "client") throw new ApiError(404, "Not a client installation");
  const needs = await activationNeeds();
  if (!needs.canActivate) throw new ApiError(409, "This installation is already activated.");
  const h = (body.hospital && typeof body.hospital === "object" ? body.hospital : {}) as Record<string, unknown>;
  const errors: Record<string, string> = {};
  const admin = needs.needsAdmin ? adminErrors((body.admin && typeof body.admin === "object" ? body.admin : {}) as Record<string, unknown>, errors) : null;
  if (Object.keys(errors).length) throw new ApiError(422, Object.values(errors)[0], errors);
  const installationId = await installationIdOf();
  let data: { licence: LicencePayload; installToken: string; licenceKey: string };
  try {
    data = (await callControl("/api/control/trial", { ...h, installationId, host: os.hostname(), version: APP_VERSION })) as typeof data;
  } catch (e) {
    // Field errors from the Control Panel belong to the hospital part of the form.
    if (e instanceof ApiError && e.fields) throw new ApiError(e.status, e.message, Object.fromEntries(Object.entries(e.fields).map(([k, v]) => [`hospital.${k}`, v])));
    throw e;
  }
  const out = await finishActivation(data, installationId, admin, req, "Started free trial");
  return { ...out, licenceKey: data.licenceKey, trialEndsAt: data.licence.expiresAt, plan: data.licence.plan?.name ?? null };
}

/* ======================= plan renewal (through the Control Panel) ======================= */

async function token() {
  const lic = await Licence.findById("licence").select("+installToken");
  if (!lic) throw new ApiError(409, "This installation is not activated");
  return lic;
}

/**
 * The super admin renews or upgrades the plan from inside the app:
 *   { action: "info", plan?, coupon? } · { action: "order", plan, coupon? } · { action: "verify", orderId, paymentId?, signature? } · { action: "invoice", id }
 * A verified payment updates the licence here immediately (also when it was locked).
 */
export async function renewal(body: Record<string, unknown>, user: SessionUser, req: Request) {
  if (appMode() !== "client") throw new ApiError(404, "Not a client installation");
  const lic = await token();
  if (lic.offline) throw new ApiError(409, "This installation uses an offline licence key. To renew, ask your vendor for a new key and enter it under Licence & Sync.");
  const action = String(body.action ?? "info");
  if (!["info", "order", "verify", "invoice"].includes(action)) throw new ApiError(400, "Unknown action");
  const data = (await callControl("/api/control/renewal", { ...body, action, by: user.name }, lic.installToken ?? undefined)) as RenewalInfo | RenewalOrder | { payment: unknown; licence: LicencePayload };
  if (action === "verify") {
    const res = data as { payment: { status: string }; licence: LicencePayload };
    if (apply(lic, res.licence)) await resetSync();
    lic.set({ lastCheckAt: new Date(), lastError: undefined });
    await lic.save();
    forgetView();
    await logActivity({ req, user, action: "update", module: "system", resource: "licence", entityLabel: lic.clientCode, summary: `Licence payment ${res.payment.status === "Paid" ? "completed" : `checked (${res.payment.status})`}; valid until ${res.licence.expiresAt?.slice(0, 10) ?? "no expiry"}` });
  }
  return data;
}

/** A client installation may have at most `maxUsers` active admins (0 = unlimited). */
export async function assertSeatAvailable(exceptUserId?: string) {
  const view = await licenceView();
  if (view.mode !== "client" || !view.maxUsers) return;
  const used = await User.countDocuments({ role: "admin", active: true, ...(exceptUserId ? { _id: { $ne: exceptUserId } } : {}) });
  if (used >= view.maxUsers) {
    throw new ApiError(422, `Your plan${view.plan ? ` (${view.plan.name})` : ""} allows ${view.maxUsers} active staff login${view.maxUsers === 1 ? "" : "s"}. Deactivate one or upgrade the plan.`);
  }
}
