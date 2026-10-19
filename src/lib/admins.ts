import "server-only";
import { ApiError } from "./api";
import { MODULE_MAP, isModuleKey, type ModuleKey } from "./modules";

export const ONLINE_WINDOW_MS = 5 * 60_000;
const PHONE_RE = /^\+?[0-9][0-9\s-]{6,17}$/;

export interface AdminRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: string;
  modules: ModuleKey[];
  active: boolean;
  online: boolean;
  lastLoginAt: string | null;
  lastActiveAt: string | null;
  lastLoginIp: string | null;
  createdAt: string | null;
  actions7d?: number;
}

interface UserLike {
  _id: unknown;
  name: string;
  email: string;
  phone?: string | null;
  role: string;
  modules?: string[];
  active?: boolean | null;
  lastLoginAt?: Date | null;
  lastActiveAt?: Date | null;
  lastLoginIp?: string | null;
  createdAt?: Date;
}

export function serializeAdmin(u: UserLike, actions7d?: number): AdminRow {
  const lastActive = u.lastActiveAt ? new Date(u.lastActiveAt) : null;
  const active = u.active !== false;
  return {
    id: String(u._id),
    name: u.name,
    email: u.email,
    phone: u.phone ?? null,
    role: u.role,
    modules: (u.modules ?? []).filter(isModuleKey),
    active,
    online: active && !!lastActive && Date.now() - lastActive.getTime() < ONLINE_WINDOW_MS,
    lastLoginAt: u.lastLoginAt ? new Date(u.lastLoginAt).toISOString() : null,
    lastActiveAt: lastActive?.toISOString() ?? null,
    lastLoginIp: u.lastLoginIp ?? null,
    createdAt: u.createdAt ? new Date(u.createdAt).toISOString() : null,
    ...(actions7d !== undefined ? { actions7d } : {}),
  };
}

const MODULES_ERROR = { modules: "Select at least one module" };

/** `allowed`: the modules that exist here (on a client installation, the licensed ones). */
export function parseModules(raw: unknown, allowed?: readonly ModuleKey[]): ModuleKey[] {
  if (!Array.isArray(raw)) throw new ApiError(422, "Select at least one module", MODULES_ERROR);
  const unique = [...new Set(raw)];
  const mods = unique.filter(isModuleKey);
  if (mods.length !== unique.length) throw new ApiError(422, "Unknown module selected", { modules: "Unknown module selected" });
  const unlicensed = allowed ? mods.filter((m) => !allowed.includes(m)) : [];
  if (unlicensed.length) throw new ApiError(422, `Not licensed: ${moduleLabels(unlicensed)}`, { modules: `Not included in your licence: ${moduleLabels(unlicensed)}` });
  if (mods.length === 0) throw new ApiError(422, "Select at least one module", MODULES_ERROR);
  return mods;
}

export function moduleLabels(mods: string[]) {
  return mods.length ? mods.map((m) => (isModuleKey(m) ? MODULE_MAP[m].label : m)).join(", ") : "none";
}

/** Validates admin profile fields; returns cleaned values and per-field errors. */
export function parseAdminProfile(body: Record<string, unknown>, partial: boolean) {
  const errors: Record<string, string> = {};
  const values: { name?: string; phone?: string } = {};
  if (!partial || "name" in body) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (name.length < 2 || name.length > 120) errors.name = "Enter the admin's full name";
    else values.name = name;
  }
  if (!partial || "phone" in body) {
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    if (phone && !PHONE_RE.test(phone)) errors.phone = "Enter a valid phone number";
    else values.phone = phone;
  }
  return { values, errors };
}
