import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { promises as dns } from "node:dns";
import { isIP } from "node:net";
import mongoose from "mongoose";
import { ApiError, clientIp, escapeRegex } from "./api";
import { logActivity } from "./audit";
import { appMode } from "./deployment";
import { KEY_VALIDITIES, LEAD_SOURCES, addLicenceMonths, type KeyValidity, type VendorInfo } from "./control-shared";
import type { Branding, LicencePayload } from "./licence-protocol";
import { isModuleKey, type ModuleKey } from "./modules";
import { assertOfflineKeys, signOfflineKey } from "./offline-licence";
import type { SessionUser } from "./session";
import { isObjectId } from "./validation";
import { nextSerial } from "@/models/Counter";
import { CLIENT_STATUSES, ControlClient, ControlLead, ControlPartner, ControlPlan } from "@/models/control";

/**
 * Control Panel: issue licences to hospitals, change what they may use, and
 * receive their check-ins and data uploads (see lib/licence.ts and lib/sync.ts
 * for the installation's side).
 */

export type ClientDocument = mongoose.HydratedDocument<mongoose.InferSchemaType<typeof ControlClient.schema>>;

const KEY_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const COLLECTION_RE = /^[a-z][a-z0-9_]{0,60}$/;
const HOST_RE = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const MAX_DOCS = 2000;

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const EJSON = () => mongoose.mongo.BSON.EJSON;

export function assertControl() {
  if (appMode() !== "control") throw new ApiError(404, "The Control Panel is not enabled on this server (APP_MODE=control).");
}

/** Licence keys: 4 × 5 characters, no look-alike letters. Compared without dashes or case. */
export function newLicenceKey() {
  const bytes = randomBytes(20);
  const raw = [...bytes].map((b) => KEY_CHARS[b % KEY_CHARS.length]).join("");
  return raw.match(/.{5}/g)!.join("-");
}
export const keyHash = (key: string) => sha256(String(key ?? "").toUpperCase().replace(/[^A-Z0-9]/g, ""));

export function fail(errors: Record<string, string>, message = "Please correct the highlighted fields"): never {
  throw new ApiError(422, message, errors);
}

export function text(v: unknown, max: number) {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

/* ======================= clients (Control Panel screens) ======================= */

export function clientOut(c: Record<string, unknown>) {
  const iso = (d: unknown) => (d instanceof Date ? d.toISOString() : null);
  return {
    id: String(c._id), code: c.code as string, name: c.name as string, contactName: c.contactName ?? null, contactPhone: c.contactPhone ?? null, contactEmail: c.contactEmail ?? null,
    city: c.city ?? null, notes: c.notes ?? null, keyLast4: c.keyLast4 ?? null, modules: (c.modules as string[]) ?? [], status: c.status as string,
    expiresAt: iso(c.expiresAt), graceDays: c.graceDays as number, syncEnabled: c.syncEnabled !== false, notice: c.notice ?? null, dbName: c.dbName as string,
    domain: c.domain ?? null, dnsTarget: c.dnsTarget ?? null,
    dnsCheck: c.dnsCheck && (c.dnsCheck as { checkedAt?: Date }).checkedAt ? { ...(c.dnsCheck as object), checkedAt: iso((c.dnsCheck as { checkedAt?: Date }).checkedAt) } : null,
    installed: !!c.installationId, activatedAt: iso(c.activatedAt), activationHost: c.activationHost ?? null,
    lastSeenAt: iso(c.lastSeenAt), lastIp: c.lastIp ?? null, lastVersion: c.lastVersion ?? null, lastHost: c.lastHost ?? null, lastStats: c.lastStats ?? null,
    lastSyncAt: iso(c.lastSyncAt), synced: c.synced ?? {}, resyncRequestedAt: iso(c.resyncRequestedAt), createdAt: iso(c.createdAt),
    plan: c.plan ? { id: String(c.plan), code: (c.planCode as string) ?? "", name: (c.planName as string) ?? "" } : null, trial: !!c.trial, maxUsers: (c.maxUsers as number) ?? 0,
    branding: brandingOut(c.branding), brandingAt: iso(c.brandingAt), source: (c.source as string) ?? null,
    partner: c.partner ? String(c.partner) : null, lead: c.lead ? String(c.lead) : null,
  };
}

export function brandingOut(b: unknown): Branding | null {
  if (!b || typeof b !== "object") return null;
  const g = (k: keyof Branding) => ((b as Record<string, unknown>)[k] as string) || null;
  const out: Branding = { appName: g("appName"), tagline: g("tagline"), address: g("address"), phone: g("phone"), email: g("email"), website: g("website"), gstin: g("gstin"), color: g("color"), logo: g("logo"), printFooter: g("printFooter") };
  return Object.values(out).some(Boolean) ? out : null;
}

/** The vendor's own details (VENDOR_* settings of the Control Panel server), for invoices and "contact your vendor". */
export function vendorInfo(): VendorInfo {
  const e = (k: string) => process.env[k]?.trim() || null;
  return { name: e("VENDOR_NAME") ?? "Smart Hospital", address: e("VENDOR_ADDRESS"), phone: e("VENDOR_PHONE"), email: e("VENDOR_EMAIL"), website: e("VENDOR_WEBSITE"), gstin: e("VENDOR_GSTIN") };
}

export async function listClients(url: URL) {
  assertControl();
  const q = text(url.searchParams.get("search"), 60);
  const status = url.searchParams.get("status");
  const filter: Record<string, unknown> = {};
  if (q) filter.$or = ["name", "code", "city", "domain", "contactName"].map((f) => ({ [f]: new RegExp(escapeRegex(q), "i") }));
  if (status && (CLIENT_STATUSES as readonly string[]).includes(status)) filter.status = status;
  const rows = await ControlClient.find(filter).sort({ name: 1 }).limit(500).lean();
  return rows.map((c) => clientOut(c as Record<string, unknown>));
}

export async function loadClient(id: string) {
  if (!isObjectId(id)) throw new ApiError(404, "Client not found");
  const c = (await ControlClient.findById(id)) as ClientDocument | null;
  if (!c) throw new ApiError(404, "Client not found");
  return c;
}

export async function getClient(id: string) {
  assertControl();
  return clientOut((await loadClient(id)).toObject() as Record<string, unknown>);
}

/** Validates the editable fields; `partial` leaves missing fields as they are. */
function parseClient(body: Record<string, unknown>, partial: boolean) {
  const errors: Record<string, string> = {};
  const set: Record<string, unknown> = {};
  const has = (k: string) => !partial || k in body;
  if (has("name")) {
    const name = text(body.name, 120);
    if (name.length < 3) errors.name = "Enter the hospital's name";
    set.name = name;
  }
  for (const [k, max] of [["contactName", 120], ["contactPhone", 20], ["contactEmail", 120], ["city", 80], ["notes", 1000], ["notice", 300]] as const) {
    if (has(k)) set[k] = text(body[k], max) || undefined;
  }
  if (has("modules")) {
    const mods = Array.isArray(body.modules) ? [...new Set(body.modules)] : [];
    if (!mods.length) errors.modules = "Select at least one module";
    else if (!mods.every(isModuleKey)) errors.modules = "Unknown module selected";
    set.modules = mods as ModuleKey[];
  }
  if (has("status")) {
    const status = String(body.status ?? "Active");
    if (!(CLIENT_STATUSES as readonly string[]).includes(status)) errors.status = "Invalid status";
    set.status = status;
  }
  if (has("expiresAt")) {
    const v = body.expiresAt;
    if (v === "" || v === null || v === undefined) set.expiresAt = null;
    else if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) set.expiresAt = new Date(`${v}T23:59:59.999Z`);
    else errors.expiresAt = "Enter a valid date";
  }
  if (has("graceDays")) {
    const g = Number(body.graceDays ?? 15);
    if (!(Number.isInteger(g) && g >= 1 && g <= 365)) errors.graceDays = "Between 1 and 365 days";
    set.graceDays = g;
  }
  if (has("syncEnabled")) set.syncEnabled = body.syncEnabled !== false;
  if (has("domain")) {
    const domain = text(body.domain, 253).toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (domain && !HOST_RE.test(domain)) errors.domain = "Enter a domain like his.cityhospital.com";
    set.domain = domain || undefined;
  }
  if (has("dnsTarget")) {
    const target = text(body.dnsTarget, 253).toLowerCase().replace(/\.$/, "");
    if (target && isIP(target) !== 4 && !HOST_RE.test(target)) errors.dnsTarget = "Enter the server's public IPv4 address or a host name";
    set.dnsTarget = target || undefined;
  }
  if (has("maxUsers")) {
    const n = Number(body.maxUsers ?? 0);
    if (!(Number.isInteger(n) && n >= 0 && n <= 10_000)) errors.maxUsers = "0 (unlimited) or more";
    set.maxUsers = n;
  }
  if (has("source")) {
    const src = text(body.source, 40);
    if (src && !(LEAD_SOURCES as readonly string[]).includes(src)) errors.source = "Unknown source";
    set.source = src || undefined;
  }
  for (const k of ["plan", "partner", "lead"] as const) {
    if (!has(k)) continue;
    const v = body[k];
    if (v === "" || v === null || v === undefined) set[k] = undefined;
    else if (isObjectId(v)) set[k] = v;
    else errors[k] = "Invalid selection";
  }
  if ("branding" in body) {
    const b = parseBranding(body.branding, errors);
    if (b !== undefined) set.branding = b;
  }
  if (Object.keys(errors).length) fail(errors);
  return set;
}

const COLOR_RE = /^#[0-9a-f]{6}$/i;
const LOGO_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
const MAX_LOGO = 200_000;

function parseBranding(raw: unknown, errors: Record<string, string>): Record<string, string> | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return {};
  if (typeof raw !== "object") {
    errors.branding = "Invalid branding";
    return undefined;
  }
  const b = raw as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const [k, max] of [["appName", 40], ["tagline", 120], ["address", 300], ["phone", 40], ["email", 120], ["website", 120], ["gstin", 20], ["printFooter", 300]] as const) {
    const v = text(b[k], max);
    if (v) out[k] = v;
  }
  if (out.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email)) errors["branding.email"] = "Enter a valid email";
  if (out.gstin) {
    out.gstin = out.gstin.toUpperCase();
    if (!/^[0-9A-Z]{15}$/.test(out.gstin)) errors["branding.gstin"] = "GSTIN has 15 letters and digits";
  }
  const color = text(b.color, 7);
  if (color) {
    if (COLOR_RE.test(color)) out.color = color.toLowerCase();
    else errors["branding.color"] = "Pick a colour";
  }
  const logo = typeof b.logo === "string" ? b.logo : "";
  if (logo) {
    if (logo.length > MAX_LOGO || !LOGO_RE.test(logo)) errors["branding.logo"] = "Use a PNG/JPEG/WebP logo under 150 KB";
    else out.logo = logo;
  }
  return out;
}

/** Plan / partner / lead references must exist; a newly chosen plan is copied by name and code. */
async function resolveRefs(set: Record<string, unknown>, current?: ClientDocument) {
  const errors: Record<string, string> = {};
  if (set.plan !== undefined) {
    if (String(set.plan) !== String(current?.plan ?? "")) {
      const plan = await ControlPlan.findById(set.plan).select("code name trial").lean();
      if (!plan) errors.plan = "Plan not found";
      else Object.assign(set, { planCode: plan.code, planName: plan.name, trial: !!plan.trial });
    }
  } else if ("plan" in set) {
    Object.assign(set, { planCode: undefined, planName: undefined, trial: false });
  }
  if (set.partner && !(await ControlPartner.exists({ _id: set.partner }))) errors.partner = "Partner not found";
  if (set.lead && !(await ControlLead.exists({ _id: set.lead }))) errors.lead = "Lead not found";
  if (Object.keys(errors).length) fail(errors);
}

export async function createClient(body: Record<string, unknown>, user: SessionUser, req: Request) {
  assertControl();
  const set = parseClient(body, false);
  await resolveRefs(set);
  if (brandingOut(set.branding)) set.brandingAt = new Date();
  else delete set.branding;
  const { c, licenceKey } = await insertClient(set, user.name);
  await logActivity({ req, user, action: "create", module: "system", resource: "control_clients", entityId: String(c._id), entityLabel: c.code, summary: `Issued licence ${c.code} to ${c.name} (${(c.modules ?? []).length} module(s)${c.planName ? `, plan ${c.planName}` : ""})` });
  return { client: clientOut(c.toObject() as Record<string, unknown>), licenceKey };
}

/** New client with its own code, database and licence key (shown once). */
export async function insertClient(set: Record<string, unknown>, createdByName: string) {
  const code = `C${String(await nextSerial("CONTROL_CLIENT")).padStart(4, "0")}`;
  const licenceKey = newLicenceKey();
  // Each client's uploaded data goes to its own database next to this one.
  const dbName = `${mongoose.connection.name}_${code.toLowerCase()}`.slice(0, 60);
  const c = (await ControlClient.create({ ...set, code, dbName, keyHash: keyHash(licenceKey), keyLast4: licenceKey.slice(-4), createdByName })) as ClientDocument;
  // Converting a lead: it now points to its client.
  if (c.lead) await ControlLead.updateOne({ _id: c.lead, client: { $exists: false } }, { $set: { client: c._id } });
  return { c, licenceKey };
}

export async function updateClient(id: string, body: Record<string, unknown>, user: SessionUser, req: Request) {
  assertControl();
  const c = await loadClient(id);
  const set = parseClient(body, true);
  await resolveRefs(set, c);
  const norm = (k: string, v: unknown) => (k === "branding" ? brandingOut(v) : v instanceof mongoose.Types.ObjectId ? String(v) : v);
  const changed = Object.keys(set).filter((k) => JSON.stringify(norm(k, set[k]) ?? null) !== JSON.stringify(norm(k, c.get(k)) ?? null));
  if (!changed.length) return clientOut(c.toObject() as Record<string, unknown>);
  if (changed.includes("branding")) {
    set.brandingAt = new Date();
    if (!brandingOut(set.branding)) set.branding = undefined;
  }
  c.set(set);
  if (changed.includes("domain") || changed.includes("dnsTarget")) c.set("dnsCheck", undefined);
  await c.save();
  await logActivity({ req, user, action: "update", module: "system", resource: "control_clients", entityId: id, entityLabel: c.code, changedFields: changed, summary: `Updated client ${c.code} ${c.name}: ${changed.join(", ")}${set.status ? ` (now ${set.status})` : ""}` });
  return clientOut(c.toObject() as Record<string, unknown>);
}

/** { action: "regenerate-key" | "offline-key" (+ plan?, validity?: "month" | "year" | "date" | "current", until?) | "reset-installation" | "resync" | "check-dns" } */
export async function clientAction(id: string, body: Record<string, unknown>, user: SessionUser, req: Request) {
  assertControl();
  const c = await loadClient(id);
  const action = String(body.action ?? "");
  const log = (summary: string) => logActivity({ req, user, action: "update", module: "system", resource: "control_clients", entityId: id, entityLabel: c.code, summary });

  if (action === "regenerate-key") {
    const licenceKey = newLicenceKey();
    c.set({ keyHash: keyHash(licenceKey), keyLast4: licenceKey.slice(-4) });
    await c.save();
    await log(`Issued a new licence key for ${c.code} ${c.name}; the old key no longer activates`);
    return { client: clientOut(c.toObject() as Record<string, unknown>), licenceKey };
  }
  if (action === "offline-key") {
    // { plan?, validity?: "month" | "year" | "date" | "current", until? }: optionally put the client on a plan and
    // set a new end date, then sign the licence as it stands — it activates any computer without the internet until it expires.
    if (c.status === "Suspended") throw new ApiError(409, "Re-activate this client before issuing an offline key.");
    // Before the new end date is saved, or a retry would extend the licence again.
    assertOfflineKeys();
    const validity = String(body.validity ?? "current") as KeyValidity;
    if (!(KEY_VALIDITIES as readonly string[]).includes(validity)) fail({ validity: "Choose how long the key is valid" });
    const set: Record<string, unknown> = {};
    if (body.plan) {
      const plan = isObjectId(body.plan) ? await ControlPlan.findOne({ _id: body.plan, active: { $ne: false }, trial: { $ne: true } }).lean() : null;
      if (!plan) fail({ plan: "Choose a plan" });
      Object.assign(set, { plan: plan._id, planCode: plan.code, planName: plan.name, trial: false, modules: plan.modules, graceDays: plan.graceDays ?? 15, maxUsers: plan.maxUsers ?? 0 });
    }
    if (validity === "month" || validity === "year") {
      set.expiresAt = addLicenceMonths(c.expiresAt, "trial" in set ? false : !!c.trial, validity === "year" ? 12 : 1);
    } else if (validity === "date") {
      const until = text(body.until, 10);
      const to = /^\d{4}-\d{2}-\d{2}$/.test(until) ? new Date(`${until}T23:59:59.999Z`) : null;
      if (!to || Number.isNaN(to.getTime()) || to.getTime() < Date.now()) fail({ until: "Enter a date after today" });
      set.expiresAt = to;
    } else if (c.expiresAt && c.expiresAt.getTime() < Date.now()) {
      throw new ApiError(409, "This client's licence has expired. Choose Monthly, Yearly or a new end date for the key.");
    }
    if (Object.keys(set).length) {
      // The Control Panel shows the same licence, and an online installation receives it at its next check-in.
      c.set(set);
      await c.save();
    }
    const offlineKey = offlineKeyFor(c);
    const period = validity === "month" ? "monthly " : validity === "year" ? "yearly " : "";
    await log(`Issued a ${period}offline licence key for ${c.code} ${c.name}${c.planName ? ` on ${c.planName}` : ""}, valid until ${c.expiresAt?.toISOString().slice(0, 10) ?? "no expiry"}`);
    return { client: clientOut(c.toObject() as Record<string, unknown>), offlineKey };
  }
  if (action === "reset-installation") {
    // The current installation's token stops working; the key can then be activated on another computer.
    c.set({ installationId: undefined, installTokenHash: undefined, activatedAt: undefined, activationHost: undefined });
    await c.save();
    await log(`Reset the installation of ${c.code} ${c.name}; the old computer is deactivated`);
    return { client: clientOut(c.toObject() as Record<string, unknown>) };
  }
  if (action === "resync") {
    c.set({ resyncRequestedAt: new Date() });
    await c.save();
    await log(`Requested a full data upload from ${c.code} ${c.name}`);
    return { client: clientOut(c.toObject() as Record<string, unknown>) };
  }
  if (action === "check-dns") {
    c.set("dnsCheck", await checkDns(c.domain ?? "", c.dnsTarget ?? ""));
    await c.save();
    return { client: clientOut(c.toObject() as Record<string, unknown>) };
  }
  throw new ApiError(400, "Unknown action");
}

/** Does `domain` resolve to `target` (an IPv4 for an A record, or a host name for a CNAME)? */
async function checkDns(domain: string, target: string) {
  const checkedAt = new Date();
  if (!domain) return { checkedAt, ok: false, found: [], message: "Set the client's domain first" };
  const [a, cname] = await Promise.all([dns.resolve4(domain).catch(() => [] as string[]), dns.resolveCname(domain).catch(() => [] as string[])]);
  const found = [...cname.map((h) => `CNAME ${h.replace(/\.$/, "")}`), ...a.map((ip) => `A ${ip}`)];
  if (!found.length) return { checkedAt, ok: false, found, message: `${domain} does not resolve yet. DNS changes can take up to 24 hours.` };
  if (!target) return { checkedAt, ok: true, found, message: `${domain} resolves; set "Points to" to verify the target` };
  if (isIP(target) === 4) {
    const ok = a.includes(target);
    return { checkedAt, ok, found, message: ok ? `${domain} points to ${target}` : `${domain} points to ${a.join(", ") || "another host"}, not ${target}` };
  }
  const targetIps = await dns.resolve4(target).catch(() => [] as string[]);
  const ok = cname.some((h) => h.replace(/\.$/, "").toLowerCase() === target) || (a.length > 0 && a.every((ip) => targetIps.includes(ip)));
  return { checkedAt, ok, found, message: ok ? `${domain} points to ${target}` : `${domain} does not point to ${target} yet` };
}

/** Uploaded data of a client: documents per collection. */
export async function clientData(id: string) {
  assertControl();
  const c = await loadClient(id);
  const db = mongoose.connection.useDb(c.dbName, { useCache: true });
  const names = (await db.listCollections()).map((x) => x.name).filter((n) => !n.startsWith("system.")).sort();
  const counts = await Promise.all(names.map(async (name) => ({ name, docs: await db.collection(name).estimatedDocumentCount() })));
  return { dbName: c.dbName, lastSyncAt: c.lastSyncAt?.toISOString() ?? null, collections: counts };
}

/* ======================= installation API (/api/control/*) ======================= */

/** `brandingAt`: the branding version the installation already has (branding is left out when it is current). */
export function payload(c: ClientDocument | Record<string, unknown>, brandingAt?: string | null): LicencePayload {
  const g = (k: string) => (c as { get?: (k: string) => unknown }).get?.(k) ?? (c as Record<string, unknown>)[k];
  const iso = (d: unknown) => (d instanceof Date ? d.toISOString() : null);
  return {
    clientCode: g("code") as string, hospitalName: g("name") as string, status: g("status") as LicencePayload["status"], modules: ((g("modules") as string[]) ?? []).filter(isModuleKey),
    expiresAt: iso(g("expiresAt")), graceDays: Number(g("graceDays") ?? 15), syncEnabled: g("syncEnabled") !== false, notice: (g("notice") as string) ?? null,
    domain: (g("domain") as string) ?? null, resyncRequestedAt: iso(g("resyncRequestedAt")), serverTime: new Date().toISOString(),
    plan: g("planCode") ? { code: g("planCode") as string, name: (g("planName") as string) ?? "" } : null, trial: !!g("trial"), maxUsers: Number(g("maxUsers") ?? 0),
    brandingAt: iso(g("brandingAt")), ...(brandingAt !== undefined && brandingAt === iso(g("brandingAt")) ? {} : { branding: brandingOut(g("branding")) }),
    vendor: (({ name, phone, email, website }) => ({ name, phone, email, website }))(vendorInfo()),
  };
}

/** The client's licence as it stands, signed as an offline key (SH1.…). */
export function offlineKeyFor(c: ClientDocument) {
  const p = payload(c);
  return signOfflineKey({ code: p.clientCode, hospital: p.hospitalName, modules: p.modules, expiresAt: p.expiresAt, maxUsers: p.maxUsers, plan: p.plan, trial: p.trial });
}

/** First run of an installation: { licenceKey, installationId, host, version } → licence + install token. */
export async function activateInstallation(body: Record<string, unknown>, req: Request) {
  assertControl();
  const key = text(body.licenceKey, 40);
  const installationId = text(body.installationId, 64);
  if (!key) fail({ licenceKey: "Enter the licence key" });
  if (!/^[a-f0-9-]{16,64}$/.test(installationId)) throw new ApiError(400, "Invalid installation id");
  const c = (await ControlClient.findOne({ keyHash: keyHash(key) }).select("+installTokenHash")) as ClientDocument | null;
  if (!c) fail({ licenceKey: "This licence key is not valid. Check it with your vendor." });
  if (c.status === "Suspended") throw new ApiError(403, "This licence is suspended. Contact your vendor.");
  if (c.installationId && c.installationId !== installationId) {
    throw new ApiError(409, `This licence is already activated on another computer${c.activationHost ? ` (${c.activationHost})` : ""}. Ask your vendor to reset the installation.`);
  }
  const host = text(body.host, 120);
  const installToken = await bindInstallation(c, installationId, body, req);
  await logActivity({ req, user: null, actorEmail: `installation@${c.code}`, action: "create", module: "system", resource: "control_clients", entityId: String(c._id), entityLabel: c.code, summary: `${c.name} activated licence ${c.code} on ${host || "a new computer"}` });
  return { licence: payload(c), installToken };
}

/** Ties the licence to this installation; returns the token it authenticates with from now on. */
export async function bindInstallation(c: ClientDocument, installationId: string, body: Record<string, unknown>, req: Request) {
  const installToken = randomBytes(32).toString("hex");
  const host = text(body.host, 120);
  c.set({ installationId, installTokenHash: sha256(installToken), activatedAt: new Date(), activationHost: host || undefined, lastSeenAt: new Date(), lastIp: clientIp(req), lastVersion: text(body.version, 20) || undefined, lastHost: host || undefined });
  await c.save();
  return installToken;
}

export async function authInstallation(req: Request) {
  assertControl();
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const c = /^[a-f0-9]{64}$/.test(token) ? ((await ControlClient.findOne({ installTokenHash: sha256(token) })) as ClientDocument | null) : null;
  if (!c) throw new ApiError(401, "This installation is not recognised. It may have been reset by the vendor.");
  return c;
}

/** Periodic check-in: { version, host, stats, brandingAt } → current licence. */
export async function heartbeat(body: Record<string, unknown>, req: Request) {
  const c = await authInstallation(req);
  const stats = body.stats && typeof body.stats === "object" ? Object.fromEntries(Object.entries(body.stats as Record<string, unknown>).filter(([, v]) => typeof v === "number" || typeof v === "string" || v === null).slice(0, 40)) : undefined;
  await ControlClient.updateOne({ _id: c._id }, { $set: { lastSeenAt: new Date(), lastIp: clientIp(req), lastVersion: text(body.version, 20) || c.lastVersion, lastHost: text(body.host, 120) || c.lastHost, ...(stats ? { lastStats: stats } : {}) } });
  return payload(c, typeof body.brandingAt === "string" || body.brandingAt === null ? (body.brandingAt as string | null) : undefined);
}

/**
 * Data upload into the client's own database:
 *   { collection, action: "upsert", docs }        changed / new documents (canonical EJSON)
 *   { collection, action: "replace", docs }       the whole (small) collection
 *   { collection, action: "count" }               documents held here
 *   { collection, action: "reconcile", ids, from, to }  delete documents in (from, to] that the client no longer has
 */
export async function receiveSync(body: Record<string, unknown>, req: Request) {
  const c = await authInstallation(req);
  if (!c.syncEnabled) throw new ApiError(409, "Data upload is turned off for this client");
  const name = String(body.collection ?? "");
  if (!COLLECTION_RE.test(name)) throw new ApiError(400, "Invalid collection");
  const coll = mongoose.connection.useDb(c.dbName, { useCache: true }).collection(name);
  const parse = (v: unknown) => (typeof v === "string" ? EJSON().parse(v, { relaxed: false }) : v ?? null);
  const action = String(body.action ?? "");
  let result: Record<string, unknown> = {};

  if (action === "count") return { count: await coll.countDocuments() };
  if (action === "upsert" || action === "replace") {
    const docs = parse(body.docs) as Record<string, unknown>[];
    if (!Array.isArray(docs) || docs.length > MAX_DOCS || docs.some((d) => !d || typeof d !== "object" || d._id === undefined)) throw new ApiError(400, `Send 0–${MAX_DOCS} documents, each with an _id`);
    if (action === "replace") await coll.deleteMany({});
    if (docs.length) {
      const res = await coll.bulkWrite(docs.map((d) => ({ replaceOne: { filter: { _id: d._id as never }, replacement: d, upsert: true } })), { ordered: false });
      result = { upserted: res.upsertedCount, modified: res.modifiedCount };
    }
  } else if (action === "reconcile") {
    const ids = parse(body.ids) as unknown[];
    if (!Array.isArray(ids) || ids.length > 10_000) throw new ApiError(400, "Send at most 10,000 ids");
    const from = parse(body.from);
    const to = parse(body.to);
    const range: Record<string, unknown> = { $nin: ids };
    if (from !== null) range.$gt = from;
    if (to !== null) range.$lte = to;
    result = { deleted: (await coll.deleteMany({ _id: range as never })).deletedCount };
  } else {
    throw new ApiError(400, "Unknown action");
  }
  const now = new Date();
  await ControlClient.updateOne({ _id: c._id }, { $set: { lastSyncAt: now, lastSeenAt: now, [`synced.${name}`]: { docs: await coll.estimatedDocumentCount(), lastAt: now } } });
  return result;
}
