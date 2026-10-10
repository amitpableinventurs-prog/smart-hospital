import bcrypt from "bcryptjs";
import { ApiError, handle, ok, readJson, clientIp } from "@/lib/api";
import { logActivity } from "@/lib/audit";
import { SESSION_COOKIE, SESSION_TTL_SECONDS, signSession } from "@/lib/auth";
import { connectDB } from "@/lib/db";
import { isValidEmail } from "@/lib/validation";
import { User } from "@/models/User";

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
// Compared against when the email is unknown so response timing does not reveal which emails exist.
const DUMMY_HASH = "$2b$12$150uWl0awnkcFAOP.hzJd.1ZnRDiTw0Azqz.KZUiVRxqx/ewwsOIy";

export const POST = handle(async (req) => {
  const body = await readJson(req);
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!isValidEmail(email) || !password) throw new ApiError(422, "Enter your email and password");

  await connectDB();
  const user = await User.findOne({ email }).select("+passwordHash +failedLogins +lockUntil");

  if (!user) {
    await bcrypt.compare(password, DUMMY_HASH);
    await logActivity({ req, user: null, actorEmail: email, action: "login_failed", module: "system", summary: `Failed sign-in for unknown account ${email}` });
    throw new ApiError(401, "Invalid email or password");
  }

  if (user.lockUntil && user.lockUntil.getTime() > Date.now()) {
    const mins = Math.ceil((user.lockUntil.getTime() - Date.now()) / 60000);
    throw new ApiError(423, `Too many failed attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`);
  }

  const actor = { id: String(user._id), name: user.name, email: user.email, role: user.role };
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    const failed = (user.failedLogins ?? 0) + 1;
    const locked = failed >= MAX_FAILED;
    await User.updateOne(
      { _id: user._id },
      locked ? { $set: { failedLogins: 0, lockUntil: new Date(Date.now() + LOCK_MINUTES * 60000) } } : { $set: { failedLogins: failed } }
    );
    await logActivity({
      req, user: actor, action: "login_failed", module: "system",
      summary: locked ? `Account locked for ${LOCK_MINUTES} min after ${MAX_FAILED} failed sign-ins` : `Failed sign-in (wrong password)`,
    });
    throw new ApiError(401, "Invalid email or password");
  }

  if (!user.active) {
    await logActivity({ req, user: actor, action: "login_failed", module: "system", summary: "Sign-in blocked: account is deactivated" });
    throw new ApiError(403, "Your account has been deactivated. Please contact the super admin.");
  }

  const now = new Date();
  await User.updateOne(
    { _id: user._id },
    { $set: { failedLogins: 0, lastLoginAt: now, lastActiveAt: now, lastLoginIp: clientIp(req) }, $unset: { lockUntil: 1 } }
  );
  await logActivity({ req, user: actor, action: "login", module: "system", summary: "Signed in" });

  const token = await signSession({ sub: actor.id, role: user.role, tv: user.tokenVersion ?? 0 });
  const res = ok({ name: user.name, role: user.role, redirectTo: user.role === "super_admin" ? "/super-admin" : "/dashboard" });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  return res;
});
