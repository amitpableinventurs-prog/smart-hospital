"use client";

import { RefreshCw, Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { GatewaySettingsCard, type GatewaySettings } from "@/components/payments/GatewaySettings";
import { GatewayBadge, TXN_STATUS_LABEL, type GatewayTxn } from "@/components/payments/Razorpay";
import { Alert, Badge, Button, Card, CardHeader, EmptyState, ErrorState, PageHeader, Pagination, Spinner, cx, inputClass, statusTone, useDebounced, useToast } from "@/components/ui";
import { api, qs } from "@/lib/client";
import { formatDateTime, formatMoney } from "@/lib/format";
import { MODULE_MAP, isModuleKey } from "@/lib/modules";
import { useApiQuery } from "@/lib/useApi";

interface Overview {
  hospital: GatewaySettings;
  admins: { id: string; name: string; email: string; modules: string[]; active: boolean; gateway: GatewaySettings }[];
  unapplied: number;
  collected30d: { account: string; amount: number; count: number }[];
}

const STATUS_FILTERS = [
  { value: "", label: "All" },
  { value: "attention", label: "Needs attention" },
  { value: "Applied", label: "Paid" },
  { value: "Created", label: "Not completed" },
  { value: "Failed", label: "Failed" },
];

export default function PaymentGatewayPage() {
  const overview = useApiQuery<Overview>("/api/payments/razorpay/overview");
  const o = overview.data;

  return (
    <>
      <PageHeader title="Payment Gateway" description="Razorpay accounts for online collections. Each admin can collect into their own account; others use the hospital account when it is shared." />
      {o && o.unapplied > 0 && (
        <div className="mb-5"><Alert tone="amber">{o.unapplied} online payment{o.unapplied === 1 ? " was" : "s were"} received on Razorpay but could not be recorded on the bill. Filter by “Needs attention” below, then check again or record them by hand.</Alert></div>
      )}
      <div className="grid items-start gap-6 xl:grid-cols-2">
        <GatewaySettingsCard url="/api/payments/razorpay/account" hospital onSaved={overview.reload} title="Hospital Razorpay account"
          description="Used by the super admin, and by admins without their own account while sharing is on." />
        <Card>
          <CardHeader title="Admin accounts" description="Where each admin's online collections go. Open an admin to set or remove their keys." />
          {overview.error ? <ErrorState message={overview.error} onRetry={overview.reload} /> : !o ? <Spinner /> : o.admins.length === 0 ? <EmptyState title="No admins yet" /> : (
            <ul className="divide-y divide-slate-100">
              {o.admins.map((a) => {
                const own = a.gateway.configured && a.gateway.enabled;
                const fallback = o.hospital.configured && o.hospital.enabled && o.hospital.shared;
                return (
                  <li key={a.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                    <div className="min-w-0 flex-1">
                      <Link href={`/super-admin/admins/${a.id}`} className="font-medium text-slate-900 hover:text-brand-700">{a.name}</Link>
                      {!a.active && <Badge tone="red">Inactive</Badge>}
                      <p className="truncate text-xs text-slate-500">{a.modules.map((m) => (isModuleKey(m) ? MODULE_MAP[m].label : m)).join(", ") || "No modules"}</p>
                    </div>
                    <div className="text-right">
                      {own ? (
                        <><p className="font-mono text-xs text-slate-700">{a.gateway.keyId}</p><GatewayBadge mode={a.gateway.mode} /></>
                      ) : fallback ? (
                        <Badge tone="blue">Hospital account</Badge>
                      ) : (
                        <Badge tone="slate">{a.gateway.configured ? "Own account off" : "No online payments"}</Badge>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {o && o.collected30d.length > 0 && (
            <div className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
              <p className="mb-1 font-medium text-slate-600">Collected online, last 30 days</p>
              {o.collected30d.map((c) => <p key={c.account} className="flex justify-between"><span>{c.account}</span><span className="tabular-nums text-slate-800">{formatMoney(c.amount)} · {c.count}</span></p>)}
            </div>
          )}
        </Card>
      </div>
      <h2 className="mb-3 mt-8 text-lg font-semibold text-slate-900">Online payments</h2>
      <Transactions onChanged={overview.reload} />
    </>
  );
}

function Transactions({ onChanged }: { onChanged: () => void }) {
  const toast = useToast();
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const q = useDebounced(search);
  const list = useApiQuery<GatewayTxn[]>(`/api/payments/razorpay/transactions${qs({ status, q, page })}`);
  const [busy, setBusy] = useState<string | null>(null);

  async function check(t: GatewayTxn) {
    setBusy(t.id);
    try {
      const { data } = await api<GatewayTxn>(`/api/payments/razorpay/transactions/${t.id}/sync`, { method: "POST" });
      toast(data.status === "Applied" ? `${formatMoney(data.amount)} recorded on ${data.target.code}` : `Razorpay status: ${TXN_STATUS_LABEL[data.status]}`, data.status === "Applied" ? "success" : "error");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
      list.reload();
      onChanged();
    }
  }

  const rows = list.data ?? [];
  return (
    <Card>
      <div className="flex flex-col gap-3 border-b border-slate-100 p-4 md:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Bill / order no., payer, Razorpay ID, collected by…" className={cx(inputClass, "pl-9")} aria-label="Search payments" />
        </div>
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className={cx(inputClass, "md:w-48")} aria-label="Status">
          {STATUS_FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
      </div>
      {list.error ? <ErrorState message={list.error} onRetry={list.reload} /> : list.loading && !list.stale ? <Spinner /> : rows.length === 0 ? (
        <EmptyState title="No online payments" description={status || q ? "Nothing matches these filters." : "Payments taken with “Pay online” in Lab, Pharmacy and Ambulance appear here."} />
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5">Started</th>
                <th className="px-4 py-2.5">Record</th>
                <th className="px-4 py-2.5">Payer</th>
                <th className="px-4 py-2.5 text-right">Amount</th>
                <th className="px-4 py-2.5">Account</th>
                <th className="px-4 py-2.5">Collected by</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5">Razorpay</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((t) => (
                <tr key={t.id} className="align-top">
                  <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">{formatDateTime(t.createdAt)}</td>
                  <td className="whitespace-nowrap px-4 py-2.5">
                    {t.target.href ? <Link href={t.target.href} className="font-mono text-brand-700 hover:underline">{t.target.code}</Link> : <span className="font-mono">{t.target.code}</span>}
                    <p className="text-xs text-slate-500">{t.target.label}</p>
                  </td>
                  <td className="px-4 py-2.5 text-slate-700">{t.payerName ?? "—"}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums font-medium text-slate-900">{formatMoney(t.amount)}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-slate-700">{t.account}<p><GatewayBadge mode={t.mode} /></p></td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-slate-700">{t.createdByName ?? "—"}</td>
                  <td className="px-4 py-2.5">
                    <Badge tone={t.status === "Unapplied" ? "red" : statusTone(TXN_STATUS_LABEL[t.status])}>{TXN_STATUS_LABEL[t.status]}</Badge>
                    {t.error && <p className="mt-1 max-w-64 text-xs text-red-600">{t.error}</p>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-slate-500">{t.paymentId ?? t.orderId}{t.method && <p className="font-sans">{t.method.toUpperCase()}</p>}</td>
                  <td className="px-4 py-2.5 text-right">
                    {t.status !== "Applied" && (
                      <Button variant="secondary" loading={busy === t.id} disabled={!!busy && busy !== t.id} onClick={() => check(t)} title="Ask Razorpay and record the payment if it was captured">
                        <RefreshCw className="size-3.5" /> Check
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination pagination={list.pagination} onPage={setPage} />
    </Card>
  );
}
