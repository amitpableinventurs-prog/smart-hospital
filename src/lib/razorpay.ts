import "server-only";
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import mongoose from "mongoose";
import { ApiError } from "./api";
import { logActivity } from "./audit";
import type { SessionUser } from "./session";
import { GatewayAccount } from "@/models/payments";
import { User } from "@/models/User";

/* ======================= secret encryption ======================= */

/**
 * Key secrets are encrypted with AES-256-GCM. The key is derived from
 * PAYMENT_KEYS_SECRET, or AUTH_SECRET when that is not set — changing it
 * makes saved secrets unreadable, so they would need to be entered again.
 */
function cipherKey() {
  const base = process.env.PAYMENT_KEYS_SECRET || process.env.AUTH_SECRET;
  if (!base || base.length < 32) throw new Error("Set AUTH_SECRET (or PAYMENT_KEYS_SECRET) to at least 32 characters");
  return Buffer.from(hkdfSync("sha256", base, "medicare", "razorpay-key-secret", 32));
}

function encrypt(plain: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", cipherKey(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), enc.toString("base64url")].join(".");
}

function decrypt(stored: string) {
  const [v, iv, tag, enc] = stored.split(".");
  if (v !== "v1" || !iv || !tag || !enc) throw new ApiError(500, "Saved Razorpay secret is unreadable. Enter the keys again.");
  try {
    const d = createDecipheriv("aes-256-gcm", cipherKey(), Buffer.from(iv, "base64url"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(enc, "base64url")), d.final()]).toString("utf8");
  } catch {
    throw new ApiError(500, "Saved Razorpay secret is unreadable (the encryption key changed). Enter the keys again.");
  }
}

/* ======================= Razorpay REST ======================= */

const API = "https://api.razorpay.com/v1";
const KEY_ID_RE = /^rzp_(test|live)_[A-Za-z0-9]{8,32}$/;
const SECRET_RE = /^[A-Za-z0-9]{16,64}$/;

export interface Credentials {
  keyId: string;
  secret: string;
}

export async function rzp<T>(cred: Credentials, method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API + path, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${cred.keyId}:${cred.secret}`).toString("base64")}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
  } catch {
    throw new ApiError(502, "Could not reach Razorpay. Check the internet connection and try again.");
  }
  const json = (await res.json().catch(() => null)) as { error?: { description?: string } } | null;
  if (res.status === 401) throw new ApiError(502, "Razorpay rejected the Key ID / Key Secret. Update the Razorpay settings.");
  if (!res.ok) throw new ApiError(502, `Razorpay: ${json?.error?.description ?? `request failed (${res.status})`}`);
  return json as T;
}

/** Razorpay's checkout signature: HMAC-SHA256(order_id|payment_id, key secret). */
export function signatureValid(secret: string, orderId: string, paymentId: string, signature: string) {
  const expected = createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  return a.length === b.length && timingSafeEqual(a, b);
}

/* ======================= accounts ======================= */

type AccountDoc = mongoose.HydratedDocument<mongoose.InferSchemaType<(typeof GatewayAccount)["schema"]>>;

export interface GatewaySettings {
  configured: boolean;
  keyId: string | null;
  secretHint: string | null;
  mode: "test" | "live" | null;
  displayName: string;
  enabled: boolean;
  shared: boolean;
  verifiedAt: string | null;
  updatedAt: string | null;
  updatedByName: string | null;
}

export function serializeAccount(a: Partial<AccountDoc> | null): GatewaySettings {
  return {
    configured: !!a,
    keyId: a?.keyId ?? null,
    secretHint: a?.secretLast4 ? `••••${a.secretLast4}` : null,
    mode: (a?.mode as "test" | "live") ?? null,
    displayName: a?.displayName ?? "",
    enabled: a ? a.enabled !== false : false,
    shared: a ? a.shared !== false : true,
    verifiedAt: a?.verifiedAt ? new Date(a.verifiedAt).toISOString() : null,
    updatedAt: a?.updatedAt ? new Date(a.updatedAt).toISOString() : null,
    updatedByName: a?.updatedByName ?? null,
  };
}

/** `owner` null means the hospital account. */
function ownerFilter(owner: string | null) {
  return owner ? { scope: "user" as const, user: new mongoose.Types.ObjectId(owner) } : { scope: "hospital" as const };
}

export async function getAccount(owner: string | null) {
  return GatewayAccount.findOne(ownerFilter(owner));
}

async function ownerLabel(owner: string | null) {
  if (!owner) return "hospital Razorpay account";
  const u = await User.findById(owner).select("name email").lean();
  return `Razorpay account of ${u?.name ?? "admin"}${u?.email ? ` <${u.email}>` : ""}`;
}

/**
 * Save keys for an owner: { keyId, keySecret?, displayName?, enabled?, shared? }.
 * The secret may be left blank to keep the saved one. New or changed keys are
 * checked against Razorpay before they are stored.
 */
export async function saveAccount(owner: string | null, body: Record<string, unknown>, actor: SessionUser, req: Request) {
  const existing = await GatewayAccount.findOne(ownerFilter(owner)).select("+secretEnc");
  const errors: Record<string, string> = {};
  const keyId = String(body.keyId ?? "").trim();
  const keySecret = String(body.keySecret ?? "").trim();
  const displayName = String(body.displayName ?? "").trim().slice(0, 80);

  if (!KEY_ID_RE.test(keyId)) errors.keyId = "Enter the Key ID from Razorpay Dashboard → Account & Settings → API Keys (starts with rzp_test_ or rzp_live_)";
  const keyChanged = !existing || existing.keyId !== keyId;
  if (keySecret) {
    if (!SECRET_RE.test(keySecret)) errors.keySecret = "Enter the Key Secret exactly as Razorpay shows it";
  } else if (keyChanged) {
    errors.keySecret = "Enter the Key Secret for this Key ID";
  }
  if (Object.keys(errors).length) throw new ApiError(422, "Please correct the highlighted fields", errors);

  const secret = keySecret || decrypt(existing!.secretEnc);
  const verify = keyChanged || !!keySecret;
  if (verify) {
    try {
      await rzp({ keyId, secret }, "GET", "/orders?count=1");
    } catch (e) {
      if (e instanceof ApiError && /rejected/.test(e.message)) {
        throw new ApiError(422, "Razorpay did not accept these keys", { keySecret: "Razorpay rejected this Key ID / Key Secret pair" });
      }
      throw e;
    }
  }

  const doc = existing ?? new GatewayAccount({ ...ownerFilter(owner) });
  doc.keyId = keyId;
  doc.mode = keyId.startsWith("rzp_live_") ? "live" : "test";
  if (keySecret || !existing) {
    doc.secretEnc = encrypt(secret);
    doc.secretLast4 = secret.slice(-4);
  }
  doc.displayName = displayName || undefined;
  if (typeof body.enabled === "boolean") doc.enabled = body.enabled;
  if (!owner && typeof body.shared === "boolean") doc.shared = body.shared;
  if (verify) doc.verifiedAt = new Date();
  doc.updatedByName = actor.name;
  await doc.save();

  await logActivity({
    req, user: actor, action: "update", module: "system", resource: "payment_gateway", entityId: String(doc._id),
    entityLabel: keyId,
    summary: `${existing ? "Updated" : "Connected"} ${await ownerLabel(owner)} (${doc.mode} mode, key ${keyId}${keySecret ? ", new secret" : ""}${doc.enabled ? "" : ", disabled"})`,
  });
  return serializeAccount(doc);
}

export async function removeAccount(owner: string | null, actor: SessionUser, req: Request) {
  const doc = await GatewayAccount.findOneAndDelete(ownerFilter(owner));
  if (!doc) throw new ApiError(404, "No Razorpay account is saved");
  await logActivity({
    req, user: actor, action: "update", module: "system", resource: "payment_gateway", entityId: String(doc._id),
    entityLabel: doc.keyId, summary: `Removed ${await ownerLabel(owner)} (key ${doc.keyId})`,
  });
  return serializeAccount(null);
}

export interface ResolvedAccount {
  id: mongoose.Types.ObjectId;
  scope: "hospital" | "user";
  label: string;
  keyId: string;
  mode: "test" | "live";
  displayName: string;
  credentials: () => Credentials;
}

function resolved(a: AccountDoc & { secretEnc: string }, label: string): ResolvedAccount {
  return {
    id: a._id,
    scope: a.scope as "hospital" | "user",
    label,
    keyId: a.keyId,
    mode: a.mode as "test" | "live",
    displayName: a.displayName || process.env.HOSPITAL_NAME || "MediCare Hospital",
    credentials: () => ({ keyId: a.keyId, secret: decrypt(a.secretEnc) }),
  };
}

/**
 * The account a user's online collections go to: their own enabled account,
 * otherwise the hospital account if it is enabled and shared with admins.
 */
export async function accountFor(user: SessionUser): Promise<ResolvedAccount | null> {
  if (user.role !== "super_admin") {
    const own = await GatewayAccount.findOne(ownerFilter(user.id)).select("+secretEnc");
    if (own?.enabled) return resolved(own as AccountDoc & { secretEnc: string }, `${user.name} (own account)`);
  }
  const hospital = await GatewayAccount.findOne(ownerFilter(null)).select("+secretEnc");
  if (hospital?.enabled && (user.role === "super_admin" || hospital.shared !== false)) {
    return resolved(hospital as AccountDoc & { secretEnc: string }, "Hospital account");
  }
  return null;
}

/** Account by id, for verifying a payment against the account its order was raised on. */
export async function accountById(id: unknown): Promise<ResolvedAccount> {
  const a = await GatewayAccount.findById(id).select("+secretEnc");
  if (!a) throw new ApiError(409, "The Razorpay account this order was raised on has been removed");
  return resolved(a as AccountDoc & { secretEnc: string }, a.scope === "hospital" ? "Hospital account" : "Admin account");
}

/** Every admin with their gateway status, for the super admin's overview. */
export async function adminAccounts() {
  const [admins, accounts] = await Promise.all([
    User.find({ role: "admin" }).select("name email modules active").sort({ name: 1 }).lean(),
    GatewayAccount.find({ scope: "user" }).lean(),
  ]);
  const byUser = new Map(accounts.map((a) => [String(a.user), a]));
  return admins.map((u) => ({
    id: String(u._id),
    name: u.name,
    email: u.email,
    modules: u.modules ?? [],
    active: u.active !== false,
    gateway: serializeAccount(byUser.get(String(u._id)) ?? null),
  }));
}
