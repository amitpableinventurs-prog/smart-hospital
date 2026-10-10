"use client";

import { Activity, CircleCheck, RefreshCw, ShieldAlert, TriangleAlert, UserCog, Users } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { ActivityChart, type DayPoint } from "@/components/ActivityChart";
import { ActivityFeed, type FeedItem } from "@/components/ActivityFeed";
import { ModuleIcon } from "@/components/ModuleIcon";
import { Button, Card, CardHeader, ErrorState, PageHeader, Spinner, StatCard, cx } from "@/components/ui";
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

  const header = (
    <PageHeader
      title="Monitoring"
      description="Live overview of admins, module allocation and operations across the hospital."
      actions={
        <>
          <Button variant="secondary" onClick={load} loading={refreshing}>
            {!refreshing && <RefreshCw className="size-4" />} Refresh
          </Button>
          <Link href="/super-admin/admins">
            <Button><UserCog className="size-4" /> Manage admins</Button>
          </Link>
        </>
      }
    />
  );

  if (!data) return <>{header}{error ? <Card><ErrorState message={error} onRetry={load} /></Card> : <Spinner label="Loading monitoring data…" />}</>;
  const k = data.kpis;
  const max7 = Math.max(1, ...data.modules.map((m) => m.actions7d));

  return (
    <>
      {header}
      {error && <p className="-mt-3 mb-4 text-xs text-red-600">Last refresh failed: {error}. Showing data from {timeAgo(data.generatedAt)}.</p>}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Admins" value={k.activeAdmins} hint={`${k.admins} total · ${k.admins - k.activeAdmins} deactivated`} icon={<Users className="size-5" />} />
        <StatCard label="Online now" value={k.onlineAdmins} hint={`Active in last ${data.onlineWindowMinutes} min`} icon={<CircleCheck className="size-5" />} tone="slate" />
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
        <div className="mt-4 flex items-start gap-2 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
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
        <Card>
          <CardHeader title="Online admins" description={`Active in the last ${data.onlineWindowMinutes} minutes`} />
          {data.online.length === 0 ? (
            <p className="px-5 py-6 text-sm text-slate-500">No admins online right now.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.online.map((a) => (
                <li key={a.id} className="flex items-center gap-3 px-5 py-3">
                  <span className="relative flex size-2.5"><span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" /><span className="relative inline-flex size-2.5 rounded-full bg-emerald-500" /></span>
                  <div className="min-w-0 flex-1">
                    <Link href={`/super-admin/admins/${a.id}`} className="block truncate text-sm font-medium text-slate-900 hover:text-brand-700">{a.name}</Link>
                    <p className="truncate text-xs text-slate-500">{a.modules.map((m) => MODULE_MAP[m].label).join(", ")}</p>
                  </div>
                  <span className="text-xs text-slate-500">{timeAgo(a.lastActiveAt)}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="border-t border-slate-100 px-5 py-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Most active (7 days)</p>
            {data.topActors.length === 0 ? (
              <p className="text-sm text-slate-500">No admin operations yet.</p>
            ) : (
              <ol className="space-y-1.5">
                {data.topActors.map((t, i) => (
                  <li key={t.id} className="flex items-center justify-between text-sm">
                    <Link href={`/super-admin/admins/${t.id}`} className="text-slate-700 hover:text-brand-700">{i + 1}. {t.name}</Link>
                    <span className="tabular-nums text-slate-900">{t.count}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="Module status" description="Records held, admins allocated, and operations in the last 7 days" />
        <div className="grid divide-y divide-slate-100 sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-5">
          {data.modules.map((m) => (
            <Link key={m.key} href={moduleHref(m.key)} className="group border-slate-100 p-4 hover:bg-slate-50 sm:border-b lg:border-r">
              <div className="flex items-center gap-2">
                <ModuleIcon name={m.icon} className="size-4 text-brand-700" />
                <span className="text-sm font-medium text-slate-900">{m.label}</span>
              </div>
              <p className="mt-2 text-2xl font-semibold tabular-nums text-slate-900">{m.records}</p>
              <p className="text-xs text-slate-500">{m.resources.map((r) => `${r.count} ${r.label.toLowerCase()}`).join(" · ")}</p>
              <div className="mt-3 h-1.5 rounded-full bg-slate-100" title={`${m.actions7d} operations in 7 days`}>
                <div className="h-1.5 rounded-full bg-brand-500" style={{ width: `${(m.actions7d / max7) * 100}%` }} />
              </div>
              <div className="mt-2 flex items-center justify-between text-xs">
                <span className={cx(m.admins === 0 ? "font-medium text-amber-700" : "text-slate-500")}>
                  {m.admins === 0 ? "No admin" : `${m.admins} admin${m.admins === 1 ? "" : "s"}`}
                </span>
                <span className="text-slate-500">{m.actions7d} ops · {m.lastActivityAt ? timeAgo(m.lastActivityAt) : "idle"}</span>
              </div>
            </Link>
          ))}
        </div>
      </Card>

      <Card className="mt-6">
        <CardHeader title="Recent activity" actions={<Link href="/super-admin/activity" className="text-xs font-medium text-brand-700 hover:underline">View full log</Link>} />
        <ActivityFeed items={data.recent} />
      </Card>
    </>
  );
}
