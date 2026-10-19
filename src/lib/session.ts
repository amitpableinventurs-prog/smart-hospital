import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { connectDB } from "./db";
import { ApiError } from "./api";
import { SESSION_COOKIE, verifySession } from "./auth";
import { licenceView } from "./licence";
import { MODULE_KEYS, type ModuleKey, type Role } from "./modules";
import { User } from "@/models/User";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  /** Modules this user may open. Super admins get every (licensed) module. */
  modules: ModuleKey[];
}

const ACTIVE_TOUCH_MS = 60_000;

/**
 * Resolve the signed-in user from the session cookie, re-checking the
 * database every time so deactivation / module changes apply immediately.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const jar = await cookies();
  const claims = await verifySession(jar.get(SESSION_COOKIE)?.value);
  if (!claims) return null;

  await connectDB();
  const user = await User.findById(claims.sub).lean();
  if (!user || !user.active || (user.tokenVersion ?? 0) !== claims.tv) return null;

  // Track presence for the super admin's monitoring view, at most once a minute.
  const now = Date.now();
  if (!user.lastActiveAt || now - new Date(user.lastActiveAt).getTime() > ACTIVE_TOUCH_MS) {
    User.updateOne({ _id: user._id }, { $set: { lastActiveAt: new Date(now) } }).catch(() => {});
  }

  // On a client installation only the modules licensed by the Control Panel exist.
  const licensed = (await licenceView()).modules ?? [...MODULE_KEYS];
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role,
    modules: user.role === "super_admin" ? licensed : (user.modules as ModuleKey[]).filter((m) => licensed.includes(m)),
  };
});

export function canAccess(user: SessionUser, module: string) {
  return (user.modules as string[]).includes(module);
}

/** For API routes: throws 401/403 ApiErrors that `handle()` turns into responses. */
export async function requireUser(opts: { module?: string; superAdmin?: boolean; allowLocked?: boolean } = {}): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new ApiError(401, "Your session has expired. Please sign in again.");
  if (!opts.allowLocked) {
    const { locked } = await licenceView();
    if (locked) throw new ApiError(423, locked.message);
  }
  if (opts.superAdmin && user.role !== "super_admin") throw new ApiError(403, "Only the super admin can do this.");
  if (opts.module && !canAccess(user, opts.module)) throw new ApiError(403, "You are not assigned to this module.");
  return user;
}
