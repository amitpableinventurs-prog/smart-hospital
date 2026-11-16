import { ArrowUpRight, History, LayoutGrid, Sparkles } from "lucide-react";
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

/** Icon tile colours, cycled across module cards so the grid is easy to scan. */
const TILES = [
  "from-brand-400 to-brand-600 shadow-brand-600/25",
  "from-violet-400 to-indigo-600 shadow-indigo-600/25",
  "from-emerald-400 to-teal-600 shadow-teal-600/25",
  "from-amber-400 to-orange-500 shadow-orange-500/25",
  "from-rose-400 to-pink-600 shadow-pink-600/25",
  "from-sky-400 to-blue-600 shadow-blue-600/25",
];

const ACTION_DOTS: Record<string, string> = { create: "bg-emerald-500", update: "bg-brand-500", delete: "bg-red-500" };

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
  const totalRecords = modules.reduce((sum, m) => sum + m.counts.reduce((s, c) => s + c.count, 0), 0);

  return (
    <>
      {/* Welcome banner */}
      <section className="relative mb-8 overflow-hidden rounded-3xl bg-brand-900 bg-linear-to-br from-brand-600 via-brand-800 to-brand-950 px-6 py-7 text-white shadow-pop sm:px-8 sm:py-8">
        <div className="pointer-events-none absolute -right-16 -top-20 size-72 rounded-full bg-brand-300/25 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute -bottom-24 left-1/3 size-72 rounded-full bg-indigo-400/20 blur-3xl" aria-hidden />
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(white_1px,transparent_1px),linear-gradient(90deg,white_1px,transparent_1px)] [background-size:28px_28px] [mask-image:linear-gradient(to_left,black,transparent_70%)]"
          aria-hidden
        />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-xs font-medium text-brand-100 ring-1 ring-inset ring-white/15">
              <Sparkles className="size-3.5" aria-hidden /> Hospital overview
            </p>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">
              {greeting}, {user.name.split(" ")[0]}
            </h1>
            <p className="mt-1.5 max-w-xl text-sm text-brand-100/90">
              You manage {modules.length} module{modules.length === 1 ? "" : "s"}. Open a panel to work with its records.
            </p>
          </div>
          <dl className="grid grid-cols-2 gap-3 sm:w-fit">
            <HeroStat icon={<LayoutGrid className="size-4" />} label="Modules" value={modules.length} />
            <HeroStat icon={<History className="size-4" />} label="Recent changes" value={recent.length} />
          </dl>
        </div>
      </section>

      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight text-slate-900">Your modules</h2>
          <p className="text-xs text-slate-500">{totalRecords.toLocaleString("en-IN")} records across your panels</p>
        </div>
      </div>

      {modules.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white/70 p-10 text-center text-sm text-slate-500">
          No modules have been allocated to your account yet. Please contact the super admin.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {modules.map((m, i) => (
            <Link
              key={m.key}
              href={moduleHref(m.key)}
              className="group relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-5 shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-card-hover"
            >
              <div className="flex items-start gap-3.5">
                <div className={`grid size-11 shrink-0 place-items-center rounded-xl bg-linear-to-br text-white shadow-lg ${TILES[i % TILES.length]}`}>
                  <ModuleIcon name={m.icon} className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold tracking-tight text-slate-900">{m.label}</p>
                  <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{m.description}</p>
                </div>
                <ArrowUpRight className="size-4 shrink-0 text-slate-300 transition-all duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-brand-600" aria-hidden />
              </div>
              <dl className="mt-5 grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-3 ring-1 ring-inset ring-slate-100">
                {m.counts.slice(0, 3).map((c) => (
                  <div key={c.label} className="min-w-0">
                    <dt className="truncate text-[11px] font-medium uppercase tracking-wide text-slate-500">{c.label}</dt>
                    <dd className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">{c.count.toLocaleString("en-IN")}</dd>
                  </div>
                ))}
              </dl>
            </Link>
          ))}
        </div>
      )}

      <div className="mt-8 rounded-2xl border border-slate-200/80 bg-white shadow-card">
        <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4">
          <div className="grid size-9 place-items-center rounded-xl bg-brand-50 text-brand-600 ring-1 ring-inset ring-brand-100">
            <History className="size-4" aria-hidden />
          </div>
          <div>
            <h2 className="text-sm font-semibold tracking-tight text-slate-900">Your recent activity</h2>
            <p className="mt-0.5 text-xs text-slate-500">Changes you made recently. The super admin can see all activity.</p>
          </div>
        </div>
        {recent.length === 0 ? (
          <p className="px-5 py-6 text-sm text-slate-500">No changes recorded yet.</p>
        ) : (
          <ul className="px-5 py-2">
            {recent.map((a, i) => (
              <li key={String(a._id)} className="relative flex items-start gap-3 py-2.5 text-sm">
                {i < recent.length - 1 && <span className="absolute left-[5px] top-6 h-full w-px bg-slate-200" aria-hidden />}
                <span className={`relative mt-1.5 size-2.5 shrink-0 rounded-full ring-4 ring-white ${ACTION_DOTS[a.action] ?? "bg-slate-400"}`} aria-hidden />
                <span className="min-w-0 flex-1 text-slate-700">
                  <span className="font-medium text-slate-900">{ACTION_LABELS[a.action] ?? a.action}</span> · {a.summary.replace(/^(Created|Updated|Deleted)\s/, "")}
                </span>
                <span className="shrink-0 pt-px text-xs text-slate-400">{a.createdAt ? formatDateTime(new Date(a.createdAt).toISOString()) : ""}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function HeroStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="min-w-36 rounded-2xl bg-white/10 px-4 py-3 ring-1 ring-inset ring-white/15 backdrop-blur">
      <dt className="flex items-center gap-1.5 text-xs font-medium text-brand-100">
        {icon}
        {label}
      </dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
