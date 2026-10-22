import { ApiError, handle, ok, readJson } from "@/lib/api";
import { moduleLabels, parseAdminProfile, parseModules, serializeAdmin } from "@/lib/admins";
import { logActivity } from "@/lib/audit";
import { connectDB } from "@/lib/db";
import { assertSeatAvailable } from "@/lib/licence";
import { requireUser } from "@/lib/session";
import { isObjectId } from "@/lib/validation";
import { ActivityLog } from "@/models/ActivityLog";
import { User } from "@/models/User";

type Ctx = { params: Promise<{ id: string }> };

async function findAdmin(id: string) {
  if (!isObjectId(id)) throw new ApiError(404, "Admin not found");
  await connectDB();
  const user = await User.findById(id);
  if (!user || user.role !== "admin") throw new ApiError(404, "Admin not found");
  return user;
}

/** Admin profile plus an activity breakdown for monitoring. */
export const GET = handle<Ctx>(async (_req, { params }) => {
  await requireUser({ superAdmin: true });
  const user = await findAdmin((await params).id);

  const since30 = new Date(Date.now() - 30 * 86400_000);
  const since7 = new Date(Date.now() - 7 * 86400_000);
  const [byModule, byAction, total7, total30, lastFailed] = await Promise.all([
    ActivityLog.aggregate<{ _id: string; n: number }>([
      { $match: { actor: user._id, createdAt: { $gte: since30 }, module: { $ne: "system" } } },
      { $group: { _id: "$module", n: { $sum: 1 } } },
      { $sort: { n: -1 } },
    ]),
    ActivityLog.aggregate<{ _id: string; n: number }>([
      { $match: { actor: user._id, createdAt: { $gte: since30 } } },
      { $group: { _id: "$action", n: { $sum: 1 } } },
      { $sort: { n: -1 } },
    ]),
    ActivityLog.countDocuments({ actor: user._id, createdAt: { $gte: since7 } }),
    ActivityLog.countDocuments({ actor: user._id, createdAt: { $gte: since30 } }),
    ActivityLog.findOne({ actor: user._id, action: "login_failed" }).sort({ createdAt: -1 }).select("createdAt").lean(),
  ]);

  return ok({
    admin: serializeAdmin(user.toObject(), total7),
    stats: {
      actions7d: total7,
      actions30d: total30,
      byModule: byModule.map((x) => ({ module: x._id, count: x.n })),
      byAction: byAction.map((x) => ({ action: x._id, count: x.n })),
      lastFailedLoginAt: lastFailed?.createdAt ? new Date(lastFailed.createdAt).toISOString() : null,
    },
  });
});

/** Update profile, re-allocate modules, or activate / deactivate an admin. */
export const PATCH = handle<Ctx>(async (req, { params }) => {
  const me = await requireUser({ superAdmin: true });
  const user = await findAdmin((await params).id);
  const body = await readJson(req);

  const { values, errors } = parseAdminProfile(body, true);
  const changes: string[] = [];

  if (values.name !== undefined && values.name !== user.name) {
    changes.push(`name "${user.name}" → "${values.name}"`);
    user.name = values.name;
  }
  if (values.phone !== undefined && values.phone !== (user.phone ?? "")) {
    changes.push("phone number");
    user.phone = values.phone || undefined;
  }
  if ("modules" in body) {
    try {
      const mods = parseModules(body.modules, me.modules);
      const before = [...(user.modules ?? [])];
      if ([...before].sort().join() !== [...mods].sort().join()) {
        changes.push(`modules ${moduleLabels(before)} → ${moduleLabels(mods)}`);
        user.modules = mods;
      }
    } catch (e) {
      if (e instanceof ApiError && e.fields) Object.assign(errors, e.fields);
      else throw e;
    }
  }
  if ("active" in body) {
    if (typeof body.active !== "boolean") errors.active = "Invalid status";
    else if (body.active !== user.active) {
      if (body.active) await assertSeatAvailable(String(user._id));
      changes.push(body.active ? "activated account" : "deactivated account");
      user.active = body.active;
      // Ends any open sessions immediately.
      if (!body.active) user.tokenVersion = (user.tokenVersion ?? 0) + 1;
    }
  }
  if (Object.keys(errors).length) throw new ApiError(422, "Please correct the highlighted fields", errors);

  if (changes.length) {
    await user.save();
    await logActivity({
      req, user: me, action: "admin_update", module: "system", resource: "admins",
      entityId: String(user._id), entityLabel: `${user.name} <${user.email}>`,
      summary: `Updated admin ${user.name}: ${changes.join("; ")}`,
    });
  }
  return ok(serializeAdmin(user.toObject()));
});
