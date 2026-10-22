"use client";

import { Building2, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ClientForm, LicenceKeyModal, isExpired, isOnline, type ClientRow } from "@/components/control/ClientForm";
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, Spinner, StatCard, cx, inputClass, useDebounced } from "@/components/ui";
import { api, qs } from "@/lib/client";
import { formatDate, timeAgo } from "@/lib/format";
import { useApiQuery } from "@/lib/useApi";

const th = "whitespace-nowrap px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500";

export default function ClientsPage() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const debounced = useDebounced(search);
  const q = useApiQuery<ClientRow[]>(`/api/control/clients${qs({ search: debounced, status })}`);
  const [plan, setPlan] = useState("");
  const all = q.data ?? q.stale ?? [];
  const soon = Date.now() + 30 * 86_400_000;
  const rows = plan === "trial" ? all.filter((c) => c.trial) : plan === "expiring" ? all.filter((c) => c.expiresAt && new Date(c.expiresAt).getTime() < soon) : all;
  const [creating, setCreating] = useState(false);
  const [issued, setIssued] = useState<{ id: string; name: string; licenceKey: string } | null>(null);

  return (
    <>
      <PageHeader
        title="Clients & Licences"
        description="Hospitals running the Windows setup: what they may use, whether they are online, and their data on this server."
        actions={<Button onClick={() => setCreating(true)}><Plus className="size-4" /> New client</Button>}
      />
      {q.error && !q.stale ? (
        <ErrorState message={q.error} onRetry={q.reload} />
      ) : (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-4">
            <StatCard label="Clients" value={rows.length} icon={<Building2 className="size-5" />} />
            <StatCard label="Online now" value={rows.filter(isOnline).length} tone="slate" />
            <StatCard label="Not activated" value={rows.filter((c) => !c.installed).length} tone="slate" />
            <StatCard label="Suspended / expired" value={rows.filter((c) => c.status === "Suspended" || isExpired(c)).length} tone={rows.some((c) => c.status === "Suspended" || isExpired(c)) ? "amber" : "slate"} />
          </div>
          <Card>
            <div className="flex flex-col gap-3 border-b border-slate-100 p-4 md:flex-row">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Hospital, code, city or domain…" className={cx(inputClass, "pl-9")} aria-label="Search clients" />
              </div>
              <select value={status} onChange={(e) => setStatus(e.target.value)} className={cx(inputClass, "md:w-44")} aria-label="Status">
                <option value="">Any status</option>
                <option>Active</option>
                <option>Suspended</option>
              </select>
              <select value={plan} onChange={(e) => setPlan(e.target.value)} className={cx(inputClass, "md:w-44")} aria-label="Plan">
                <option value="">Any plan</option>
                <option value="trial">On free trial</option>
                <option value="expiring">Expiring in 30 days</option>
              </select>
            </div>
            {q.loading && !q.stale ? (
              <Spinner label="Loading clients…" />
            ) : rows.length === 0 ? (
              <EmptyState title={debounced || status || plan ? "No clients match" : "No clients yet"} description="Create a client to issue a licence key for their installation." action={!debounced && !status && !plan && <Button onClick={() => setCreating(true)}><Plus className="size-4" /> New client</Button>} />
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-100 text-sm">
                  <thead className="bg-slate-50/60"><tr>{["Hospital", "Licence", "Plan", "Installation", "Last check-in", "Data upload"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((c) => (
                      <tr key={c.id} className="hover:bg-slate-50/60">
                        <td className="px-4 py-2.5">
                          <Link href={`/super-admin/clients/${c.id}`} className="font-medium text-slate-900 hover:text-brand-700">{c.name}</Link>
                          <div className="text-xs text-slate-500"><span className="font-mono">{c.code}</span>{c.city ? ` · ${c.city}` : ""}{c.domain ? ` · ${c.domain}` : ""}</div>
                        </td>
                        <td className="px-4 py-2.5">
                          {c.status === "Suspended" ? <Badge tone="red">Suspended</Badge> : isExpired(c) ? <Badge tone="red">Expired</Badge> : <Badge tone="green">Active</Badge>}
                          <div className="mt-0.5 text-xs text-slate-500">{c.expiresAt ? `Until ${formatDate(c.expiresAt)}` : "No expiry"}</div>
                        </td>
                        <td className="px-4 py-2.5 text-slate-700">
                          {c.plan ? c.plan.name : <span className="text-slate-500">Custom</span>} {c.trial && <Badge tone="violet">Trial</Badge>}
                          <div className="text-xs text-slate-500">{c.modules.length} module(s){c.maxUsers ? ` · ${c.maxUsers} logins` : ""}</div>
                        </td>
                        <td className="px-4 py-2.5 text-slate-700">{c.installed ? c.activationHost ?? "Activated" : <span className="text-slate-500">Not activated</span>}{c.lastVersion && <div className="text-xs text-slate-500">v{c.lastVersion}</div>}</td>
                        <td className="px-4 py-2.5">{isOnline(c) ? <Badge tone="green">Online</Badge> : <span className="text-slate-600">{c.lastSeenAt ? timeAgo(c.lastSeenAt) : "Never"}</span>}</td>
                        <td className="px-4 py-2.5 text-slate-600">{!c.syncEnabled ? <span className="text-slate-400">Off</span> : c.lastSyncAt ? timeAgo(c.lastSyncAt) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
      {creating && (
        <ClientForm
          onClose={() => setCreating(false)}
          onSubmit={async (body) => {
            const { data } = await api<{ client: ClientRow; licenceKey: string }>("/api/control/clients", { method: "POST", body });
            setCreating(false);
            setIssued({ id: data.client.id, name: data.client.name, licenceKey: data.licenceKey });
            q.reload();
          }}
        />
      )}
      {issued && <LicenceKeyModal name={issued.name} licenceKey={issued.licenceKey} onClose={() => { router.push(`/super-admin/clients/${issued.id}`); setIssued(null); }} />}
    </>
  );
}
