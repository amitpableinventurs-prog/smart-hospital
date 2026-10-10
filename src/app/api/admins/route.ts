import bcrypt from "bcryptjs";
import { ApiError, escapeRegex, handle, ok, pagination, parsePaging, readJson } from "@/lib/api";
import { moduleLabels, parseAdminProfile, parseModules, serializeAdmin } from "@/lib/admins";
import { logActivity } from "@/lib/audit";
import { connectDB } from "@/lib/db";
import { isModuleKey, type ModuleKey } from "@/lib/modules";
import { requireUser } from "@/lib/session";
import { isValidEmail, validatePassword } from "@/lib/validation";
import { ActivityLog } from "@/models/ActivityLog";
import { User } from "@/models/User";

/** List admins with their module allocation and recent activity volume. */
export const GET = handle(async (req) => {
  await requireUser({ superAdmin: true });
  await connectDB();
  const url = new URL(req.url);
  const { page, limit, skip } = parsePaging(url, 20);

  const filter: Record<string, unknown> = { role: "admin" };
  const q = url.searchParams.get("search")?.trim();
  if (q) {
    const rx = new RegExp(escapeRegex(q.slice(0, 100)), "i");
    filter.$or = [{ name: rx }, { email: rx }, { phone: rx }];
  }
  const mod = url.searchParams.get("module");
  if (mod && isModuleKey(mod)) filter.modules = mod;
  const status = url.searchParams.get("status");
  if (status === "active") filter.active = true;
  if (status === "inactive") filter.active = false;

  const [users, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    User.countDocuments(filter),
  ]);

  const since = new Date(Date.now() - 7 * 86400_000);
  const counts = await ActivityLog.aggregate<{ _id: unknown; n: number }>([
    { $match: { actor: { $in: users.map((u) => u._id) }, createdAt: { $gte: since } } },
    { $group: { _id: "$actor", n: { $sum: 1 } } },
  ]);
  const byActor = new Map(counts.map((c) => [String(c._id), c.n]));

  return ok(
    users.map((u) => serializeAdmin(u, byActor.get(String(u._id)) ?? 0)),
    { pagination: pagination(page, limit, total) }
  );
});

/** Create an admin and allocate modules to them. */
export const POST = handle(async (req) => {
  const me = await requireUser({ superAdmin: true });
  const body = await readJson(req);

  const { values, errors } = parseAdminProfile(body, false);
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!isValidEmail(email)) errors.email = "Enter a valid email address";
  const pwError = validatePassword(body.password);
  if (pwError) errors.password = pwError;
  let modules: ModuleKey[] = [];
  try {
    modules = parseModules(body.modules);
  } catch (e) {
    if (e instanceof ApiError && e.fields) Object.assign(errors, e.fields);
    else throw e;
  }
  if (Object.keys(errors).length) throw new ApiError(422, "Please correct the highlighted fields", errors);

  await connectDB();
  if (await User.exists({ email })) {
    throw new ApiError(409, "An account with this email already exists", { email: "Already in use" });
  }

  const user = await User.create({
    name: values.name,
    email,
    phone: values.phone || undefined,
    role: "admin",
    modules,
    active: true,
    passwordHash: await bcrypt.hash(String(body.password), 12),
    createdBy: me.id,
  });

  await logActivity({
    req, user: me, action: "admin_create", module: "system", resource: "admins",
    entityId: String(user._id), entityLabel: `${user.name} <${email}>`,
    summary: `Created admin ${user.name} with access to: ${moduleLabels(modules)}`,
  });
  return ok(serializeAdmin(user.toObject()), { status: 201 });
});
