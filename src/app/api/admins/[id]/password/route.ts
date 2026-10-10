import bcrypt from "bcryptjs";
import { ApiError, handle, ok, readJson } from "@/lib/api";
import { logActivity } from "@/lib/audit";
import { connectDB } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { isObjectId, validatePassword } from "@/lib/validation";
import { User } from "@/models/User";

type Ctx = { params: Promise<{ id: string }> };

/** Super admin sets a new password for an admin; their existing sessions end. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const me = await requireUser({ superAdmin: true });
  const { id } = await params;
  const body = await readJson(req);
  const pwError = validatePassword(body.password);
  if (pwError) throw new ApiError(422, pwError, { password: pwError });
  if (!isObjectId(id)) throw new ApiError(404, "Admin not found");

  await connectDB();
  const user = await User.findById(id);
  if (!user || user.role !== "admin") throw new ApiError(404, "Admin not found");

  user.passwordHash = await bcrypt.hash(String(body.password), 12);
  user.tokenVersion = (user.tokenVersion ?? 0) + 1;
  user.set({ failedLogins: 0, lockUntil: undefined });
  await user.save();

  await logActivity({
    req, user: me, action: "admin_password_reset", module: "system", resource: "admins",
    entityId: id, entityLabel: `${user.name} <${user.email}>`, summary: `Reset password for admin ${user.name}`,
  });
  return ok({ reset: true });
});
