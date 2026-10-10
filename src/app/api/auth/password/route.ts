import bcrypt from "bcryptjs";
import { ApiError, handle, ok, readJson } from "@/lib/api";
import { logActivity } from "@/lib/audit";
import { SESSION_COOKIE, SESSION_TTL_SECONDS, signSession } from "@/lib/auth";
import { requireUser } from "@/lib/session";
import { validatePassword } from "@/lib/validation";
import { User } from "@/models/User";

/** Change your own password. Other sessions are signed out; this one is re-issued. */
export const POST = handle(async (req) => {
  const me = await requireUser();
  const body = await readJson(req);
  const current = typeof body.currentPassword === "string" ? body.currentPassword : "";
  const next = body.newPassword;

  const pwError = validatePassword(next);
  if (pwError) throw new ApiError(422, pwError, { newPassword: pwError });

  const user = await User.findById(me.id).select("+passwordHash");
  if (!user || !(await bcrypt.compare(current, user.passwordHash))) {
    throw new ApiError(422, "Current password is incorrect", { currentPassword: "Current password is incorrect" });
  }

  user.passwordHash = await bcrypt.hash(String(next), 12);
  user.tokenVersion = (user.tokenVersion ?? 0) + 1;
  await user.save();
  await logActivity({ req, user: me, action: "password_change", module: "system", summary: "Changed own password" });

  const res = ok({ changed: true });
  res.cookies.set(SESSION_COOKIE, await signSession({ sub: me.id, role: me.role, tv: user.tokenVersion }), {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: SESSION_TTL_SECONDS,
  });
  return res;
});
