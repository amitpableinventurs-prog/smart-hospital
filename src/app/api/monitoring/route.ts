import { handle, ok } from "@/lib/api";
import { ONLINE_WINDOW_MS, serializeAdmin } from "@/lib/admins";
import { connectDB } from "@/lib/db";
import { MODULES } from "@/lib/modules";
import { moduleCounts } from "@/lib/records";
import { requireUser } from "@/lib/session";
import { ActivityLog, type ActivityAction } from "@/models/ActivityLog";
import { User } from "@/models/User";

const DAYS = 14;

/** Everything the super admin's monitoring overview needs, in one request. */
export const GET = handle(async () => {
  await requireUser({ superAdmin: true });
  await connectDB();

  const now = Date.now();
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const since7 = new Date(now - 7 * 86400_000);
  const seriesStart = new Date(startOfToday.getTime() - (DAYS - 1) * 86400_000);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const opActions: ActivityAction[] = ["create", "update", "delete"];

  const [admins, actionsToday, actions7d, failedLogins24h, daily, moduleActivity, topActors, recent] = await Promise.all([
    User.find({ role: "admin" }).sort({ lastActiveAt: -1 }).lean(),
    ActivityLog.countDocuments({ createdAt: { $gte: startOfToday }, action: { $in: opActions } }),
    ActivityLog.countDocuments({ createdAt: { $gte: since7 }, action: { $in: opActions } }),
    ActivityLog.countDocuments({ createdAt: { $gte: new Date(now - 86400_000) }, action: "login_failed" }),
    ActivityLog.aggregate<{ _id: { day: string; action: string }; n: number }>([
      { $match: { createdAt: { $gte: seriesStart }, action: { $in: opActions } } },
      { $group: { _id: { day: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone } }, action: "$action" }, n: { $sum: 1 } } },
    ]),
    ActivityLog.aggregate<{ _id: string; n: number; last: Date }>([
      { $match: { createdAt: { $gte: since7 }, module: { $ne: "system" } } },
      { $group: { _id: "$module", n: { $sum: 1 }, last: { $max: "$createdAt" } } },
    ]),
    ActivityLog.aggregate<{ _id: unknown; n: number; name: string }>([
      { $match: { createdAt: { $gte: since7 }, actorRole: "admin", action: { $in: opActions } } },
      { $group: { _id: "$actor", n: { $sum: 1 }, name: { $last: "$actorName" } } },
      { $sort: { n: -1 } },
      { $limit: 5 },
    ]),
    ActivityLog.find({}).sort({ createdAt: -1 }).limit(12).lean(),
  ]);

  // Daily operations series, filling empty days with zero.
  const series: { day: string; create: number; update: number; delete: number }[] = [];
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" });
  for (let i = 0; i < DAYS; i++) {
    series.push({ day: fmt.format(new Date(seriesStart.getTime() + i * 86400_000 + 12 * 3600_000)), create: 0, update: 0, delete: 0 });
  }
  const byDay = new Map(series.map((s) => [s.day, s]));
  for (const row of daily) {
    const bucket = byDay.get(row._id.day);
    if (bucket && (row._id.action === "create" || row._id.action === "update" || row._id.action === "delete")) bucket[row._id.action] += row.n;
  }

  const activityByModule = new Map(moduleActivity.map((m) => [m._id, m]));
  const modules = await Promise.all(
    MODULES.map(async (m) => {
      const counts = await moduleCounts(m);
      const act = activityByModule.get(m.key);
      return {
        key: m.key,
        label: m.label,
        icon: m.icon,
        resources: counts,
        records: counts.reduce((s, c) => s + c.count, 0),
        actions7d: act?.n ?? 0,
        lastActivityAt: act?.last ? new Date(act.last).toISOString() : null,
        admins: admins.filter((a) => a.active !== false && (a.modules ?? []).includes(m.key)).length,
      };
    })
  );

  const rows = admins.map((a) => serializeAdmin(a));
  return ok({
    generatedAt: new Date(now).toISOString(),
    onlineWindowMinutes: ONLINE_WINDOW_MS / 60_000,
    kpis: {
      admins: rows.length,
      activeAdmins: rows.filter((a) => a.active).length,
      onlineAdmins: rows.filter((a) => a.online).length,
      actionsToday,
      actions7d,
      failedLogins24h,
      unassignedModules: modules.filter((m) => m.admins === 0).length,
    },
    series,
    modules,
    online: rows.filter((a) => a.online),
    topActors: topActors.map((t) => ({ id: String(t._id), name: t.name, count: t.n })),
    recent: recent.map((d) => ({
      id: String(d._id),
      createdAt: d.createdAt ? new Date(d.createdAt).toISOString() : null,
      actorId: d.actor ? String(d.actor) : null,
      actorName: d.actorName ?? d.actorEmail ?? "Unknown",
      actorRole: d.actorRole ?? null,
      action: d.action,
      module: d.module,
      summary: d.summary,
    })),
  });
});
