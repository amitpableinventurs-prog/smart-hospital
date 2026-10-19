import "server-only";
import { randomUUID } from "node:crypto";
import os from "node:os";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { ApiError } from "./api";
import { logActivity } from "./audit";
import { connectDB } from "./db";
import { APP_VERSION, appMode, controlUrl } from "./deployment";
import type { LicencePayload, LicenceView } from "./licence-protocol";
import { isModuleKey } from "./modules";
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

const unlicensed = (mode: LicenceView["mode"]): LicenceView => ({
  mode, hospitalName: process.env.HOSPITAL_NAME || null, clientCode: null, locked: null, modules: null, notice: null, expiresAt: null, lastCheckAt: null,
  offlineDaysLeft: null, offlineDays: null, expiresInDays: null, lastError: null,
});

function viewOf(lic: (LicenceDoc & { lastCheckAt?: Date | null }) | null): LicenceView {
  if (!lic) return { ...unlicensed("client"), hospitalName: null, locked: { reason: "not_activated", message: "This installation has not been activated yet." } };
  const now = Date.now();
  const lastCheck = lic.lastCheckAt ?? lic.activatedAt ?? null;
  const offlineDays = lastCheck ? (now - lastCheck.getTime()) / DAY : Infinity;
  const graceDays = lic.graceDays ?? 15;
  let locked: LicenceView["locked"] = null;
  if (lic.status === "Deactivated") locked = { reason: "deactivated", message: "This installation was deactivated by your vendor. Activate it again with a licence key." };
  else if (lic.status === "Suspended") locked = { reason: "suspended", message: lic.notice || "Your licence is suspended. Please contact your vendor." };
  else if (lic.expiresAt && lic.expiresAt.getTime() < now) locked = { reason: "expired", message: `Your licence expired on ${lic.expiresAt.toISOString().slice(0, 10)}. Please contact your vendor to renew it.` };
  else if (offlineDays > graceDays) locked = { reason: "offline", message: `This computer has not reached the licence server for ${Math.floor(offlineDays)} days (allowed: ${graceDays}). Connect it to the internet and press "Check again".` };
  return {
    mode: "client", hospitalName: lic.hospitalName, clientCode: lic.clientCode, locked, modules: (lic.modules ?? []).filter(isModuleKey), notice: lic.notice ?? null,
    expiresAt: lic.expiresAt?.toISOString() ?? null, lastCheckAt: lastCheck?.toISOString() ?? null,
    offlineDaysLeft: Number.isFinite(offlineDays) ? Math.max(0, Math.ceil(graceDays - offlineDays)) : 0, offlineDays: Number.isFinite(offlineDays) ? Math.floor(offlineDays) : null,
    expiresInDays: lic.expiresAt ? Math.ceil((lic.expiresAt.getTime() - now) / DAY) : null, lastError: lic.lastError ?? null,
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
  const view = viewOf(await Licence.findById("licence").lean());
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
  });
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
    let result: { ok: boolean; error?: string } = { ok: true };
    let resync = false;
    try {
      const payload = (await callControl("/api/control/heartbeat", { version: APP_VERSION, host: os.hostname(), stats: await localStats() }, lic.installToken)) as LicencePayload;
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
 */
export async function activate(body: Record<string, unknown>, req: Request) {
  if (appMode() !== "client") throw new ApiError(404, "Not a client installation");
  const needs = await activationNeeds();
  if (!needs.canActivate) throw new ApiError(409, "This installation is already activated.");
  const licenceKey = typeof body.licenceKey === "string" ? body.licenceKey.trim() : "";
  const admin = (body.admin && typeof body.admin === "object" ? body.admin : {}) as Record<string, unknown>;
  const errors: Record<string, string> = {};
  if (!licenceKey) errors.licenceKey = "Enter the licence key from your vendor";
  const name = typeof admin.name === "string" ? admin.name.trim() : "";
  const email = typeof admin.email === "string" ? admin.email.trim().toLowerCase() : "";
  const password = typeof admin.password === "string" ? admin.password : "";
  if (needs.needsAdmin) {
    if (name.length < 2) errors["admin.name"] = "Enter the administrator's name";
    if (!isValidEmail(email)) errors["admin.email"] = "Enter a valid email";
    if (password.length < 8) errors["admin.password"] = "Use at least 8 characters";
  }
  if (Object.keys(errors).length) throw new ApiError(422, Object.values(errors)[0], errors);

  const existing = await Licence.findById("licence").lean();
  const installationId = existing?.installationId ?? randomUUID();
  const data = (await callControl("/api/control/activate", { licenceKey, installationId, host: os.hostname(), version: APP_VERSION })) as { licence: LicencePayload; installToken: string };

  const now = new Date();
  await Licence.deleteOne({ _id: "licence" });
  const lic = new Licence({ _id: "licence", clientCode: data.licence.clientCode, hospitalName: data.licence.hospitalName, installationId, installToken: data.installToken, activatedAt: now, lastCheckAt: now, lastAttemptAt: now });
  apply(lic, data.licence);
  await lic.save();
  let created = null;
  if (needs.needsAdmin) {
    created = await User.create({ name, email, passwordHash: await bcrypt.hash(password, 12), role: "super_admin", modules: [], active: true });
  }
  forgetView();
  await logActivity({
    req, user: created ? { id: String(created._id), name: created.name, email: created.email, role: "super_admin" } : null, actorEmail: email || undefined,
    action: "create", module: "system", resource: "licence", entityLabel: data.licence.clientCode,
    summary: `Activated licence ${data.licence.clientCode} for ${data.licence.hospitalName} on ${os.hostname()}${created ? `; created administrator ${email}` : ""}`,
  });
  return { hospitalName: data.licence.hospitalName, createdAdmin: !!created };
}
