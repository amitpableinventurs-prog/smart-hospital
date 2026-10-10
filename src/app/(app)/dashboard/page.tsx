import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ModuleIcon } from "@/components/ModuleIcon";
import { ACTION_LABELS, formatDateTime } from "@/lib/format";
import { MODULE_MAP, moduleHref } from "@/lib/modules";
import { getSessionUser } from "@/lib/session";
import { ActivityLog } from "@/models/ActivityLog";
import { moduleCounts } from "@/lib/records";

export const metadata: Metadata = { title: "Dashboard" };

// Session-checked, per-user data: allowed to block (see (app)/layout.tsx).
export const instant = false;

export default async function DashboardPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const modules = await Promise.all(
    user.modules.map(async (key) => {
      const m = MODULE_MAP[key];
      const counts = await moduleCounts(m);
      return { ...m, counts };
    })
  );
  const recent = await ActivityLog.find({ actor: user.id, action: { $in: ["create", "update", "delete"] } }).sort({ createdAt: -1 }).limit(8).lean();

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{greeting}, {user.name.split(" ")[0]}</h1>
        <p className="mt-1 text-sm text-slate-500">
          You manage {modules.length} module{modules.length === 1 ? "" : "s"}. Open a panel to work with its records.
        </p>
      </div>

      {modules.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
          No modules have been allocated to your account yet. Please contact the super admin.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {modules.map((m) => (
            <Link key={m.key} href={moduleHref(m.key)} className="group rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-brand-200 hover:shadow-md">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-brand-50 p-2.5 text-brand-700 group-hover:bg-brand-100">
                  <ModuleIcon name={m.icon} className="size-5" />
                </div>
                <div>
                  <p className="font-semibold text-slate-900">{m.label}</p>
                  <p className="text-xs text-slate-500">{m.description}</p>
                </div>
              </div>
              <dl className="mt-4 flex gap-6">
                {m.counts.slice(0, 3).map((c) => (
                  <div key={c.label}>
                    <dt className="text-xs text-slate-500">{c.label}</dt>
                    <dd className="text-xl font-semibold tabular-nums text-slate-900">{c.count}</dd>
                  </div>
                ))}
              </dl>
            </Link>
          ))}
        </div>
      )}

      <div className="mt-8 rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-900">Your recent activity</h2>
          <p className="mt-0.5 text-xs text-slate-500">Changes you made recently. The super admin can see all activity.</p>
        </div>
        {recent.length === 0 ? (
          <p className="px-5 py-6 text-sm text-slate-500">No changes recorded yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {recent.map((a) => (
              <li key={String(a._id)} className="flex items-center justify-between gap-4 px-5 py-3 text-sm">
                <span className="text-slate-700">
                  <span className="font-medium text-slate-900">{ACTION_LABELS[a.action] ?? a.action}</span> · {a.summary.replace(/^(Created|Updated|Deleted)\s/, "")}
                </span>
                <span className="shrink-0 text-xs text-slate-500">{a.createdAt ? formatDateTime(new Date(a.createdAt).toISOString()) : ""}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
