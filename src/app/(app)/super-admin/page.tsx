"use client";

import { Activity, ArrowUpRight, CircleCheck, RefreshCw, ShieldAlert, TriangleAlert, Trophy, UserCog, Users } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { ActivityChart, type DayPoint } from "@/components/ActivityChart";
import { ActivityFeed, type FeedItem } from "@/components/ActivityFeed";
import { ModuleIcon } from "@/components/ModuleIcon";
import { Card, CardHeader, ErrorState, Spinner, StatCard, cx } from "@/components/ui";
import { useApiQuery } from "@/lib/useApi";
import { timeAgo } from "@/lib/format";
import { MODULE_MAP, moduleHref, type ModuleKey } from "@/lib/modules";

interface Monitoring {
  generatedAt: string;
  onlineWindowMinutes: number;
  kpis: { admins: number; activeAdmins: number; onlineAdmins: number; actionsToday: number; actions7d: number; failedLogins24h: number; unassignedModules: number };
  series: DayPoint[];
  modules: { key: ModuleKey; label: string; icon: string; records: number; resources: { key: string; label: string; count: number }[]; actions7d: number; lastActivityAt: string | null; admins: number }[];
  online: { id: string; name: string; email: string; modules: ModuleKey[]; lastActiveAt: string | null }[];
  topActors: { id: string; name: string; count: number }[];
  recent: FeedItem[];
}

const REFRESH_MS = 30_000;

export default function SuperAdminOverview() {
  const query = useApiQuery<Monitoring>("/api/monitoring");
  const data = query.data ?? query.stale ?? null;
  const { error, loading: refreshing, reload: load } = query;

  useEffect(() => {
    const t = setInterval(() => document.visibilityState === "visible" && load(), REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  const header = <Hero data={data} refreshing={refreshing} onRefresh={load} />;

  if (!data) return <>{header}{error ? <Card><ErrorState message={error} onRetry={load} /></Card> : <Spinner label="Loading monitoring data…" />}</>;
  const k = data.kpis;
  const max7 = Math.max(1, ...data.modules.map((m) => m.actions7d));
  const maxActor = Math.max(1, ...data.topActors.map((t) => t.count));

  return (
    <>
      {header}
      {error && <p className="-mt-4 mb-4 text-xs text-red-600">Last refresh failed: {error}. Showing data from {timeAgo(data.generatedAt)}.</p>}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Admins" value={k.activeAdmins} hint={`${k.admins} total · ${k.admins - k.activeAdmins} deactivated`} icon={<Users className="size-5" />} />
        <StatCard label="Online now" value={k.onlineAdmins} hint={`Active in last ${data.onlineWindowMinutes} min`} icon={<CircleCheck className="size-5" />} tone={k.onlineAdmins > 0 ? "brand" : "slate"} />
        <StatCard label="Operations today" value={k.actionsToday} hint={`${k.actions7d} in the last 7 days`} icon={<Activity className="size-5" />} />
        <StatCard
          label="Failed sign-ins (24h)"
          value={k.failedLogins24h}
          hint={k.failedLogins24h > 0 ? "Review the activity log" : "No failed attempts"}
          icon={<ShieldAlert className="size-5" />}
          tone={k.failedLogins24h > 0 ? "red" : "slate"}
        />
      </div>

      {k.unassignedModules > 0 && (
        <div className="mt-4 flex items-center gap-3 rounded-2xl bg-linear-to-r from-amber-50 to-orange-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-200/80">
          <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-700">
            <TriangleAlert className="size-4" aria-hidden />
          </span>
          <span>
            {k.unassignedModules} module{k.unassignedModules === 1 ? " has" : "s have"} no active admin allocated. <Link href="/super-admin/admins" className="font-medium underline">Allocate admins</Link>
          </span>
        </div>
      )}

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Operations per day" description="Records created, updated and deleted by all users — last 14 days" />
          <div className="p-5">
            <ActivityChart data={data.series} />
          </div>
        </Card>
        <Card className="flex flex-col">
          <CardHeader
            title="Online admins"
            description={`Active in the last ${data.onlineWindowMinutes} minutes`}
            actions={<span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold tabular-nums text-emerald-700 ring-1 ring-inset ring-emerald-600/20">{data.online.length}</span>}
          />
          {data.online.length === 0 ? (
            <div className="flex flex-col items-center px-5 py-8 text-center">
              <span className="grid size-10 place-items-center rounded-2xl bg-slate-100 text-slate-400"><Users className="size-5" aria-hidden /></span>
              <p className="mt-2 text-sm text-slate-500">No admins online right now.</p>
            </div>
          ) : (
            <ul className="space-y-1 p-2">
              {data.online.map((a) => (
                <li key={a.id} className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-slate-50">
                  <span className="relative shrink-0">
                    <span className="grid size-9 place-items-center rounded-full bg-linear-to-br from-brand-400 to-brand-700 text-xs font-semibold text-white">{initialsOf(a.name)}</span>
                    <span className="absolute -bottom-0.5 -right-0.5 flex size-3">
                      <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                      <span className="relative inline-flex size-3 rounded-full bg-emerald-500 ring-2 ring-white" />
                    </span>
                  </span>
                  <div className="min-w-0 flex-1">
                    <Link href={`/super-admin/admins/${a.id}`} className="block truncate text-sm font-medium text-slate-900 hover:text-brand-700">{a.name}</Link>
                    <p className="truncate text-xs text-slate-500">{a.modules.map((m) => MODULE_MAP[m].label).join(", ")}</p>
                  </div>
                  <span className="shrink-0 text-xs text-slate-400">{timeAgo(a.lastActiveAt)}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-auto border-t border-slate-100 px-5 py-4">
            <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <Trophy className="size-3.5 text-amber-500" aria-hidden /> Most active (7 days)
            </p>
            {data.topActors.length === 0 ? (
              <p className="text-sm text-slate-500">No admin operations yet.</p>
            ) : (
              <ol className="space-y-2.5">
                {data.topActors.map((t, i) => (
                  <li key={t.id} className="text-sm">
                    <div className="flex items-center gap-2.5">
                      <span className={cx("grid size-5 shrink-0 place-items-center rounded-md text-[11px] font-semibold tabular-nums", RANKS[i] ?? "bg-slate-100 text-slate-600")}>{i + 1}</span>
                      <Link href={`/super-admin/admins/${t.id}`} className="min-w-0 flex-1 truncate text-slate-700 hover:text-brand-700">{t.name}</Link>
                      <span className="font-medium tabular-nums text-slate-900">{t.count}</span>
                    </div>
                    <div className="ml-7.5 mt-1 h-1 rounded-full bg-slate-100">
                      <div className="h-1 rounded-full bg-linear-to-r from-brand-400 to-brand-600" style={{ width: `${(t.count / maxActor) * 100}%` }} />
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </Card>
      </div>

      <div className="mt-8 mb-4 flex items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight text-slate-900">Module status</h2>
          <p className="text-xs text-slate-500">Records held, admins allocated, and operations in the last 7 days</p>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {data.modules.map((m, i) => (
          <Link
            key={m.key}
            href={moduleHref(m.key)}
            className="group relative flex flex-col rounded-2xl border border-slate-200/80 bg-white p-4 shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-card-hover"
          >
            <div className="flex items-center gap-3">
              <span className={cx("grid size-10 shrink-0 place-items-center rounded-xl bg-linear-to-br text-white shadow-md", TILES[i % TILES.length])}>
                <ModuleIcon name={m.icon} className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold tracking-tight text-slate-900">{m.label}</p>
                <p className={cx("text-xs", m.admins === 0 ? "font-medium text-amber-700" : "text-slate-500")}>
                  {m.admins === 0 ? "No admin allocated" : `${m.admins} admin${m.admins === 1 ? "" : "s"}`}
                </p>
              </div>
              <ArrowUpRight className="size-4 shrink-0 text-slate-300 transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-brand-600" aria-hidden />
            </div>
            <p className="mt-4 text-2xl font-semibold tabular-nums tracking-tight text-slate-900">
              {m.records.toLocaleString("en-IN")} <span className="text-xs font-medium text-slate-400">records</span>
            </p>
            <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{m.resources.map((r) => `${r.count} ${r.label.toLowerCase()}`).join(" · ")}</p>
            <div className="mt-auto pt-4">
              <div className="h-1.5 rounded-full bg-slate-100" title={`${m.actions7d} operations in 7 days`}>
                <div className="h-1.5 rounded-full bg-linear-to-r from-brand-400 to-brand-600" style={{ width: `${(m.actions7d / max7) * 100}%` }} />
              </div>
              <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                <span className="tabular-nums">{m.actions7d} ops / 7d</span>
                <span className="flex items-center gap-1">
                  <span className={cx("size-1.5 rounded-full", m.lastActivityAt ? "bg-emerald-500" : "bg-slate-300")} aria-hidden />
                  {m.lastActivityAt ? timeAgo(m.lastActivityAt) : "idle"}
                </span>
              </div>
            </div>
          </Link>
        ))}
      </div>

      <Card className="mt-8">
        <CardHeader
          title="Recent activity"
          description="Latest operations by every user"
          actions={
            <Link href="/super-admin/activity" className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-brand-700 transition-colors hover:bg-brand-50">
              View full log <ArrowUpRight className="size-3.5" aria-hidden />
            </Link>
          }
        />
        <ActivityFeed items={data.recent} />
      </Card>
    </>
  );
}

const TILES = [
  "from-brand-400 to-brand-600 shadow-brand-600/25",
  "from-violet-400 to-indigo-600 shadow-indigo-600/25",
  "from-emerald-400 to-teal-600 shadow-teal-600/25",
  "from-amber-400 to-orange-500 shadow-orange-500/25",
  "from-rose-400 to-pink-600 shadow-pink-600/25",
  "from-sky-400 to-blue-600 shadow-blue-600/25",
];

const RANKS = ["bg-amber-100 text-amber-800", "bg-slate-200 text-slate-700", "bg-orange-100 text-orange-800"];

function initialsOf(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?";
}

/** Gradient banner: title, live status and the page actions. */
function Hero({ data, refreshing, onRefresh }: { data: Monitoring | null; refreshing: boolean; onRefresh: () => void }) {
  const totalRecords = data?.modules.reduce((s, m) => s + m.records, 0) ?? null;
  return (
    <section className="relative mb-6 overflow-hidden rounded-3xl bg-brand-900 bg-linear-to-br from-brand-600 via-brand-800 to-brand-950 px-6 py-7 text-white shadow-pop sm:px-8">
      <div className="pointer-events-none absolute -right-16 -top-20 size-72 rounded-full bg-brand-300/25 blur-3xl" aria-hidden />
      <div className="pointer-events-none absolute -bottom-24 left-1/3 size-72 rounded-full bg-indigo-400/20 blur-3xl" aria-hidden />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(white_1px,transparent_1px),linear-gradient(90deg,white_1px,transparent_1px)] [background-size:28px_28px] [mask-image:linear-gradient(to_left,black,transparent_70%)]"
        aria-hidden
      />
      <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-2.5 py-1 text-xs font-medium text-brand-100 ring-1 ring-inset ring-white/15">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-300 opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
            </span>
            Live · {data ? `updated ${timeAgo(data.generatedAt)}` : "connecting…"}
          </p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">Monitoring</h1>
          <p className="mt-1.5 max-w-xl text-sm text-brand-100/90">Live overview of admins, module allocation and operations across the hospital.</p>
          <div className="mt-5 flex flex-wrap gap-2">
            <button
              onClick={onRefresh}
              disabled={refreshing}
              className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-3.5 py-2 text-sm font-medium text-white ring-1 ring-inset ring-white/20 backdrop-blur transition-all hover:bg-white/20 active:scale-[0.98] disabled:opacity-70"
            >
              <RefreshCw className={cx("size-4", refreshing && "animate-spin")} aria-hidden /> Refresh
            </button>
            <Link
              href="/super-admin/admins"
              className="inline-flex items-center gap-2 rounded-xl bg-white px-3.5 py-2 text-sm font-medium text-brand-800 shadow-lg shadow-brand-950/30 transition-all hover:bg-brand-50 active:scale-[0.98]"
            >
              <UserCog className="size-4" aria-hidden /> Manage admins
            </Link>
          </div>
        </div>
        {data && (
          <dl className="grid grid-cols-3 gap-3">
            <HeroStat label="Modules" value={data.modules.length} />
            <HeroStat label="Records" value={totalRecords ?? 0} />
            <HeroStat label="Ops / 7 days" value={data.kpis.actions7d} />
          </dl>
        )}
      </div>
    </section>
  );
}

function HeroStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-24 rounded-2xl bg-white/10 px-4 py-3 ring-1 ring-inset ring-white/15 backdrop-blur sm:min-w-32">
      <dt className="text-xs font-medium text-brand-100">{label}</dt>
      <dd className="mt-1 text-xl font-semibold tabular-nums sm:text-2xl">{value.toLocaleString("en-IN")}</dd>
    </div>
  );
}
