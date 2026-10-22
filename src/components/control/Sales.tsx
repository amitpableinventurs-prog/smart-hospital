"use client";

import { BadgePercent, Gift, Handshake, IndianRupee, MessageCircle, Pencil, Phone, Plus, RefreshCcw, Search, Trash2, TrendingUp, UserPlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { TableCard } from "../TableCard";
import { Alert, Badge, Button, Card, CardHeader, ConfirmDialog, EmptyState, ErrorState, Field, Modal, Pagination, Spinner, StatCard, cx, errorRing, inputClass, omitKey, statusTone, useDebounced, useToast } from "../ui";
import { ClientForm, LicenceKeyModal, type ClientPrefill, type ClientRow } from "./ClientForm";
import { useSalesOptions } from "./Payments";
import { ApiClientError, api, qs } from "@/lib/client";
import { LEAD_SOURCES, LEAD_STATUSES, PARTNER_TYPES } from "@/lib/control-shared";
import { formatDate, formatMoney, timeAgo } from "@/lib/format";
import { useApiQuery } from "@/lib/useApi";

/* ======================= a small form dialog ======================= */

interface FormField {
  name: string;
  label: string;
  type?: "text" | "textarea" | "number" | "date" | "select" | "checkbox" | "checklist" | "email" | "tel";
  options?: { value: string; label: string }[];
  required?: boolean;
  hint?: string;
  placeholder?: string;
  wide?: boolean;
}
type FormValues = Record<string, string | boolean | string[]>;

function SalesForm({ title, description, fields, initial, confirmLabel, onSubmit, onClose }: { title: string; description?: string; fields: FormField[]; initial: FormValues; confirmLabel: string; onSubmit: (v: FormValues) => Promise<void>; onClose: () => void }) {
  const [v, setV] = useState<FormValues>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string, value: string | boolean | string[]) => {
    setV((s) => ({ ...s, [k]: value }));
    if (errors[k]) setErrors((x) => omitKey(x, k));
  };
  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit(v);
    } catch (err) {
      setError((err as Error).message);
      if (err instanceof ApiClientError && err.fields) setErrors(err.fields);
      setBusy(false);
    }
  }
  return (
    <Modal open onClose={onClose} size="lg" title={title} description={description}
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button onClick={() => submit()} loading={busy}>{confirmLabel}</Button></>}>
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
        {error && <div className="sm:col-span-2"><Alert>{error}</Alert></div>}
        {fields.map((f) => {
          const id = `sf-${f.name}`;
          const cls = `${inputClass} ${errorRing(errors[f.name])}`;
          const value = v[f.name];
          return (
            <Field key={f.name} label={f.label} htmlFor={id} required={f.required} error={errors[f.name]} hint={f.hint} className={f.wide || f.type === "textarea" || f.type === "checklist" ? "sm:col-span-2" : undefined}>
              {f.type === "textarea" ? (
                <textarea id={id} value={String(value ?? "")} onChange={(e) => set(f.name, e.target.value)} rows={3} className={cls} />
              ) : f.type === "select" ? (
                <select id={id} value={String(value ?? "")} onChange={(e) => set(f.name, e.target.value)} className={cls}>
                  {!f.required && <option value="">—</option>}
                  {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : f.type === "checkbox" ? (
                <label className="flex h-[38px] items-center gap-2 text-sm text-slate-700"><input id={id} type="checkbox" checked={!!value} onChange={(e) => set(f.name, e.target.checked)} className="size-4 accent-brand-600" /> {f.placeholder ?? "Yes"}</label>
              ) : f.type === "checklist" ? (
                <div className="flex flex-wrap gap-2">
                  {f.options?.map((o) => {
                    const list = Array.isArray(value) ? value : [];
                    const on = list.includes(o.value);
                    return (
                      <label key={o.value} className={cx("flex cursor-pointer items-center gap-2 rounded-lg px-3 py-1.5 text-sm ring-1 ring-inset", on ? "bg-brand-50 ring-brand-300" : "ring-slate-200")}>
                        <input type="checkbox" checked={on} onChange={() => set(f.name, on ? list.filter((x) => x !== o.value) : [...list, o.value])} className="size-4 accent-brand-600" /> {o.label}
                      </label>
                    );
                  })}
                </div>
              ) : (
                <input id={id} type={f.type ?? "text"} value={String(value ?? "")} placeholder={f.placeholder} onChange={(e) => set(f.name, e.target.value)} className={cls} />
              )}
            </Field>
          );
        })}
      </form>
    </Modal>
  );
}

const opts = (list: readonly string[]) => list.map((x) => ({ value: x, label: x }));
const th = "whitespace-nowrap px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500";
const pctText = (n: number | null) => (n === null ? "—" : `${n}%`);
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const waLink = (phone: string, text: string) => `https://wa.me/${phone.replace(/\D/g, "").replace(/^(\d{10})$/, "91$1")}?text=${encodeURIComponent(text)}`;

/** Search, filters, paging and delete for one Control Panel sales resource. */
function useSalesList<T extends { id: string }>(resource: string, filters: Record<string, string>) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const debounced = useDebounced(search);
  const q = useApiQuery<T[]>(`/api/control/sales/${resource}${qs({ search: debounced, page, ...filters })}`);
  return { q, rows: q.data ?? q.stale ?? [], search, setSearch: (s: string) => { setSearch(s); setPage(1); }, setPage, filtered: !!debounced || Object.values(filters).some(Boolean) };
}

function SearchBar({ value, onChange, placeholder, children }: { value: string; onChange: (s: string) => void; placeholder: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border-b border-slate-100 p-4 md:flex-row">
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
        <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={cx(inputClass, "pl-9")} aria-label="Search" />
      </div>
      {children}
    </div>
  );
}

/* ======================= overview ======================= */

interface Overview {
  from: string;
  to: string;
  totals: { leads: number; won: number; conversionPct: number | null; trials: number; trialConversionPct: number | null; revenue: number; collected: number; gst: number; payments: number; onlinePayments: number; commission: number; activePaid: number; activeTrials: number; followUpsDue: number };
  funnel: { status: string; count: number }[];
  bySource: { source: string; leads: number; won: number; conversionPct: number | null }[];
  byPlan: { plan: string; payments: number; revenue: number }[];
  renewals: { id: string; code: string; name: string; city: string | null; contactName: string | null; phone: string | null; email: string | null; plan: string | null; trial: boolean; expiresAt: string | null; daysLeft: number | null; lastSeenAt: string | null }[];
  due: { id: string; code: string; hospitalName: string; contactName: string | null; phone: string | null; status: string; source: string; nextFollowUp: string | null }[];
  partners: { id: string; name: string; payments: number; sales: number; commission: number }[];
  coupons: { code: string; kind: string; value: number; used: number; maxUses: number }[];
}

export function SalesOverview() {
  const [to, setTo] = useState(() => isoDay(new Date()));
  const [from, setFrom] = useState(() => isoDay(new Date(Date.now() - 29 * 86_400_000)));
  const q = useApiQuery<Overview>(`/api/control/sales/overview${qs({ from, to })}`);
  const d = q.data ?? q.stale;

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center gap-3 p-4">
        <span className="text-sm font-medium text-slate-700">Period</span>
        <input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} className={`${inputClass} w-auto`} aria-label="From" />
        <span className="text-sm text-slate-500">to</span>
        <input type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} className={`${inputClass} w-auto`} aria-label="To" />
      </Card>
      {q.error && !d ? (
        <ErrorState message={q.error} onRetry={q.reload} />
      ) : !d ? (
        <Spinner label="Loading overview…" />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Revenue (before GST)" value={formatMoney(d.totals.revenue)} hint={`${d.totals.payments} payment(s), ${d.totals.onlinePayments} in-app`} icon={<IndianRupee className="size-5" />} />
            <StatCard label="New leads" value={d.totals.leads} hint={`Won ${d.totals.won} · conversion ${pctText(d.totals.conversionPct)}`} icon={<UserPlus className="size-5" />} />
            <StatCard label="Free trials started" value={d.totals.trials} hint={`Converted ${pctText(d.totals.trialConversionPct)} · ${d.totals.activeTrials} running now`} icon={<Gift className="size-5" />} tone="slate" />
            <StatCard label="Paying hospitals" value={d.totals.activePaid} hint={`Follow-ups due: ${d.totals.followUpsDue}`} icon={<TrendingUp className="size-5" />} tone={d.totals.followUpsDue ? "amber" : "brand"} />
          </div>

          <Card>
            <CardHeader title="Renewals & trials ending" description="Licences ending in the next 30 days or ended in the last 30 — call them before their app locks." />
            {d.renewals.length === 0 ? (
              <p className="px-5 py-4 text-sm text-slate-500">Nothing ending soon.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-100 text-sm">
                  <thead><tr>{["Hospital", "Plan", "Ends", "Contact", "Last online"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {d.renewals.map((c) => (
                      <tr key={c.id}>
                        <td className="px-4 py-2"><Link href={`/super-admin/clients/${c.id}`} className="font-medium text-slate-900 hover:text-brand-700">{c.name}</Link><div className="text-xs text-slate-500">{c.code}{c.city ? ` · ${c.city}` : ""}</div></td>
                        <td className="px-4 py-2">{c.plan ?? "—"} {c.trial && <Badge tone="violet">Trial</Badge>}</td>
                        <td className="whitespace-nowrap px-4 py-2">{c.daysLeft !== null && c.daysLeft < 0 ? <span className="font-medium text-red-700">Ended {-c.daysLeft} day(s) ago</span> : <span className={c.daysLeft !== null && c.daysLeft <= 7 ? "font-medium text-amber-700" : "text-slate-700"}>In {c.daysLeft} day(s)</span>}<div className="text-xs text-slate-500">{formatDate(c.expiresAt)}</div></td>
                        <td className="px-4 py-2 text-slate-700">
                          {c.contactName ?? "—"}
                          {c.phone && (
                            <div className="flex gap-2 text-xs">
                              <a href={`tel:${c.phone}`} className="text-brand-700 hover:underline">{c.phone}</a>
                              <a href={waLink(c.phone, `Hello ${c.contactName ?? ""}, your Smart Hospital ${c.trial ? "free trial" : "licence"} for ${c.name} ${c.daysLeft !== null && c.daysLeft < 0 ? "has ended" : `ends on ${formatDate(c.expiresAt)}`}. You can renew in the app under Licence & Sync, or reply here for help.`)} target="_blank" rel="noreferrer" className="text-emerald-700 hover:underline">WhatsApp</a>
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-2 text-slate-600">{c.lastSeenAt ? timeAgo(c.lastSeenAt) : "Never"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <TableCard title="Follow-ups due" description="Open leads whose next follow-up is today or earlier." headers={["Lead", "Source", "Status", "Due"]} empty="Nothing is due."
            rows={d.due.map((l) => [
              <span key="l"><span className="font-medium">{l.hospitalName}</span> <span className="font-mono text-xs text-slate-500">{l.code}</span><span className="block text-xs text-slate-500">{[l.contactName, l.phone].filter(Boolean).join(" · ")}</span></span>,
              l.source, <Badge key="s" tone={statusTone(l.status)}>{l.status}</Badge>, formatDate(l.nextFollowUp),
            ])} />

          <div className="grid gap-4 lg:grid-cols-2">
            <TableCard title="Lead funnel" description={`Leads ${formatDate(d.from)} – ${formatDate(d.to)} by current status`} headers={["Status", "Leads"]} empty="No leads in this period." rows={d.totals.leads ? d.funnel.map((f) => [f.status, f.count]) : []} />
            <TableCard title="Where leads come from" headers={["Source", "Leads", "Won", "Conversion"]} empty="No leads in this period." rows={d.bySource.map((s) => [s.source, s.leads, s.won, pctText(s.conversionPct)])} />
            <TableCard title="Revenue by plan" headers={["Plan", "Payments", "Revenue"]} empty="No payments in this period." rows={d.byPlan.map((p) => [p.plan, p.payments, formatMoney(p.revenue)])} />
            <TableCard title="Partner sales" description="Payments in this period by hospitals a partner brought in." headers={["Partner", "Payments", "Sales", "Commission"]} empty="No partner sales in this period." rows={d.partners.map((p) => [p.name, p.payments, formatMoney(p.sales), formatMoney(p.commission)])} />
          </div>
          <TableCard title="Coupon usage" headers={["Coupon", "Discount", "Used"]} empty="No coupon has been used yet." rows={d.coupons.map((c) => [<span key="c" className="font-mono">{c.code}</span>, c.kind === "Percent" ? `${c.value}%` : formatMoney(c.value), c.maxUses ? `${c.used} / ${c.maxUses}` : c.used])} />
        </>
      )}
    </div>
  );
}

/* ======================= leads ======================= */

interface LeadRow {
  id: string;
  code: string;
  hospitalName: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  beds: number | null;
  source: string;
  status: string;
  interestedPlan: { id: string; name: string } | null;
  partner: { id: string; name: string } | null;
  client: { id: string; code: string; name: string } | null;
  nextFollowUp: string | null;
  notes: string | null;
  lostReason: string | null;
  createdAt: string | null;
  createdByName: string | null;
  overdue: boolean;
}

export function LeadsTab() {
  const toast = useToast();
  const router = useRouter();
  const options = useSalesOptions();
  const [status, setStatus] = useState("");
  const [source, setSource] = useState("");
  const [due, setDue] = useState(false);
  const list = useSalesList<LeadRow>("leads", { status, source, due: due ? "1" : "" });
  const [editing, setEditing] = useState<LeadRow | "new" | null>(null);
  const [converting, setConverting] = useState<LeadRow | null>(null);
  const [issued, setIssued] = useState<{ id: string; name: string; licenceKey: string } | null>(null);
  const [deleting, setDeleting] = useState<LeadRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const planOpts = (options.data?.plans ?? []).filter((p) => !p.trial).map((p) => ({ value: p.id, label: p.name }));
  const partnerOpts = (options.data?.partners ?? []).map((p) => ({ value: p.id, label: p.name }));

  const fields: FormField[] = [
    { name: "hospitalName", label: "Hospital", required: true, wide: true },
    { name: "contactName", label: "Contact person" },
    { name: "phone", label: "Mobile", type: "tel" },
    { name: "email", label: "Email", type: "email" },
    { name: "city", label: "City" },
    { name: "beds", label: "Beds", type: "number" },
    { name: "source", label: "Source", type: "select", options: opts(LEAD_SOURCES), required: true },
    { name: "status", label: "Status", type: "select", options: opts(LEAD_STATUSES), required: true },
    { name: "interestedPlan", label: "Interested in plan", type: "select", options: planOpts },
    { name: "partner", label: "Referred by partner", type: "select", options: partnerOpts },
    { name: "nextFollowUp", label: "Next follow-up", type: "date" },
    { name: "lostReason", label: "Lost reason", hint: "If the status is Lost" },
    { name: "notes", label: "Notes", type: "textarea" },
  ];
  const initial = (l?: LeadRow): FormValues => ({
    hospitalName: l?.hospitalName ?? "", contactName: l?.contactName ?? "", phone: l?.phone ?? "", email: l?.email ?? "", city: l?.city ?? "", beds: l?.beds != null ? String(l.beds) : "",
    source: l?.source ?? "Phone call", status: l?.status ?? "New", interestedPlan: l?.interestedPlan?.id ?? "", partner: l?.partner?.id ?? "",
    nextFollowUp: l?.nextFollowUp ?? isoDay(new Date(Date.now() + 86_400_000)), lostReason: l?.lostReason ?? "", notes: l?.notes ?? "",
  });

  async function quickStatus(l: LeadRow, next: string) {
    try {
      await api(`/api/control/sales/leads/${l.id}`, { method: "PATCH", body: { status: next } });
      list.q.reload();
    } catch (e) {
      toast((e as Error).message);
    }
  }

  async function remove() {
    if (!deleting) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/control/sales/leads/${deleting.id}`, { method: "DELETE" });
      setDeleting(null);
      list.q.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const prefill = (l: LeadRow): ClientPrefill => ({ name: l.hospitalName, city: l.city, contactName: l.contactName, contactPhone: l.phone, contactEmail: l.email, source: l.source, partner: l.partner?.id ?? null, plan: l.interestedPlan?.id ?? null, lead: l.id });

  return (
    <>
      <Card>
        <SearchBar value={list.search} onChange={list.setSearch} placeholder="Hospital, contact, phone, city…">
          <select value={status} onChange={(e) => { setStatus(e.target.value); list.setPage(1); }} className={cx(inputClass, "md:w-40")} aria-label="Status"><option value="">Any status</option>{LEAD_STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
          <select value={source} onChange={(e) => { setSource(e.target.value); list.setPage(1); }} className={cx(inputClass, "md:w-40")} aria-label="Source"><option value="">Any source</option>{LEAD_SOURCES.map((s) => <option key={s}>{s}</option>)}</select>
          <label className="flex items-center gap-2 whitespace-nowrap text-sm text-slate-700"><input type="checkbox" checked={due} onChange={(e) => { setDue(e.target.checked); list.setPage(1); }} className="size-4 accent-brand-600" /> Follow-up due</label>
          <Button onClick={() => setEditing("new")}><Plus className="size-4" /> New lead</Button>
        </SearchBar>
        {list.q.error && !list.q.stale ? (
          <ErrorState message={list.q.error} onRetry={list.q.reload} />
        ) : list.q.loading && !list.q.stale ? (
          <Spinner label="Loading leads…" />
        ) : list.rows.length === 0 ? (
          <EmptyState title={list.filtered ? "No leads match" : "No leads yet"} description="Leads come from free trials, the pricing page's demo form, partners — or add them yourself." />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead className="bg-slate-50/60"><tr>{["Hospital", "Contact", "Source", "Status", "Follow-up", ""].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-slate-100">
                {list.rows.map((l) => (
                  <tr key={l.id} className="align-top hover:bg-slate-50/60">
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-slate-900">{l.hospitalName}</p>
                      <p className="text-xs text-slate-500"><span className="font-mono">{l.code}</span>{l.city ? ` · ${l.city}` : ""}{l.beds ? ` · ${l.beds} beds` : ""}{l.interestedPlan ? ` · wants ${l.interestedPlan.name}` : ""}</p>
                      {l.notes && <p className="mt-0.5 line-clamp-2 max-w-sm text-xs text-slate-500">{l.notes}</p>}
                    </td>
                    <td className="px-4 py-2.5 text-slate-700">
                      {l.contactName ?? "—"}
                      <div className="flex flex-wrap gap-2 text-xs">
                        {l.phone && <a href={`tel:${l.phone}`} className="inline-flex items-center gap-0.5 text-brand-700 hover:underline"><Phone className="size-3" />{l.phone}</a>}
                        {l.phone && <a href={waLink(l.phone, `Hello ${l.contactName ?? ""}, thank you for your interest in Smart Hospital for ${l.hospitalName}.`)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-emerald-700 hover:underline"><MessageCircle className="size-3" />WhatsApp</a>}
                      </div>
                      {l.email && <a href={`mailto:${l.email}`} className="block text-xs text-slate-500 hover:underline">{l.email}</a>}
                    </td>
                    <td className="px-4 py-2.5 text-slate-700">{l.source}{l.partner && <div className="text-xs text-slate-500">via {l.partner.name}</div>}<div className="text-xs text-slate-400">{timeAgo(l.createdAt)}</div></td>
                    <td className="px-4 py-2.5">
                      <select value={l.status} onChange={(e) => quickStatus(l, e.target.value)} className="rounded-md border-0 bg-transparent py-0.5 pl-1 pr-6 text-xs ring-1 ring-inset ring-slate-200" aria-label={`Status of ${l.hospitalName}`}>
                        {LEAD_STATUSES.map((s) => <option key={s}>{s}</option>)}
                      </select>
                      {l.client && <Link href={`/super-admin/clients/${l.client.id}`} className="mt-1 block text-xs text-brand-700 hover:underline">Client {l.client.code}</Link>}
                      {l.status === "Lost" && l.lostReason && <p className="mt-0.5 text-xs text-slate-500">{l.lostReason}</p>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5">{l.nextFollowUp ? <span className={l.overdue ? "font-medium text-red-700" : "text-slate-700"}>{formatDate(l.nextFollowUp)}</span> : <span className="text-slate-400">—</span>}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right">
                      <div className="flex justify-end gap-1">
                        {!l.client && l.status !== "Lost" && <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => setConverting(l)}><RefreshCcw className="size-3.5" /> Make client</Button>}
                        <Button variant="ghost" className="px-2 py-1" onClick={() => setEditing(l)} aria-label={`Edit ${l.hospitalName}`}><Pencil className="size-3.5" /></Button>
                        {!l.client && <Button variant="ghost" className="px-2 py-1" onClick={() => { setError(null); setDeleting(l); }} aria-label={`Delete ${l.hospitalName}`}><Trash2 className="size-3.5" /></Button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination pagination={list.q.pagination} onPage={list.setPage} />
      </Card>
      {editing && (
        <SalesForm title={editing === "new" ? "New lead" : `Edit ${editing.hospitalName}`} fields={fields} initial={initial(editing === "new" ? undefined : editing)} confirmLabel="Save" onClose={() => setEditing(null)}
          onSubmit={async (v) => {
            if (editing === "new") await api("/api/control/sales/leads", { method: "POST", body: v });
            else await api(`/api/control/sales/leads/${editing.id}`, { method: "PATCH", body: v });
            toast("Lead saved");
            setEditing(null);
            list.q.reload();
          }} />
      )}
      {converting && (
        <ClientForm prefill={prefill(converting)} onClose={() => setConverting(null)}
          onSubmit={async (body) => {
            const { data } = await api<{ client: ClientRow; licenceKey: string }>("/api/control/clients", { method: "POST", body });
            setConverting(null);
            setIssued({ id: data.client.id, name: data.client.name, licenceKey: data.licenceKey });
            list.q.reload();
          }} />
      )}
      {issued && <LicenceKeyModal name={issued.name} licenceKey={issued.licenceKey} onClose={() => { router.push(`/super-admin/clients/${issued.id}`); setIssued(null); }} />}
      <ConfirmDialog open={!!deleting} title={`Delete lead ${deleting?.hospitalName}?`} message="Mark it Lost instead to keep it in your conversion figures." confirmLabel="Delete" danger loading={busy} error={error} onConfirm={remove} onClose={() => setDeleting(null)} />
    </>
  );
}

/* ======================= partners ======================= */

interface PartnerRow {
  id: string;
  code: string;
  name: string;
  partnerType: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  commissionPct: number;
  referralCode: string;
  active: boolean;
  notes: string | null;
  leads: number;
  clients: number;
  sales: number;
  commission: number;
  commissionDue: number;
}

export function PartnersTab() {
  const toast = useToast();
  const list = useSalesList<PartnerRow>("partners", {});
  const [editing, setEditing] = useState<PartnerRow | "new" | null>(null);
  const fields: FormField[] = [
    { name: "name", label: "Partner / firm", required: true },
    { name: "partnerType", label: "Type", type: "select", options: opts(PARTNER_TYPES), required: true },
    { name: "contactName", label: "Contact person" },
    { name: "phone", label: "Mobile", type: "tel" },
    { name: "email", label: "Email", type: "email" },
    { name: "city", label: "City" },
    { name: "commissionPct", label: "Commission %", type: "number", hint: "Of each payment before GST" },
    { name: "referralCode", label: "Referral code", hint: "Hospitals enter it when they start a free trial. Blank = generate" },
    { name: "active", label: "Active", type: "checkbox", placeholder: "Can refer hospitals" },
    { name: "notes", label: "Notes", type: "textarea" },
  ];
  const initial = (p?: PartnerRow): FormValues => ({
    name: p?.name ?? "", partnerType: p?.partnerType ?? "Referral", contactName: p?.contactName ?? "", phone: p?.phone ?? "", email: p?.email ?? "", city: p?.city ?? "",
    commissionPct: String(p?.commissionPct ?? 10), referralCode: p?.referralCode ?? "", active: p?.active ?? true, notes: p?.notes ?? "",
  });

  return (
    <>
      <Card>
        <SearchBar value={list.search} onChange={list.setSearch} placeholder="Partner, contact, city or referral code…">
          <Button onClick={() => setEditing("new")}><Plus className="size-4" /> New partner</Button>
        </SearchBar>
        {list.q.error && !list.q.stale ? (
          <ErrorState message={list.q.error} onRetry={list.q.reload} />
        ) : list.q.loading && !list.q.stale ? (
          <Spinner label="Loading partners…" />
        ) : list.rows.length === 0 ? (
          <EmptyState title={list.filtered ? "No partners match" : "No partners yet"} description="Resellers and referrers who bring you hospitals. They earn commission on what those hospitals pay." />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead className="bg-slate-50/60"><tr>{["Partner", "Referral code", "Leads", "Clients", "Sales", "Commission", ""].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-slate-100">
                {list.rows.map((p) => (
                  <tr key={p.id} className={cx("hover:bg-slate-50/60", !p.active && "opacity-60")}>
                    <td className="px-4 py-2.5"><p className="font-medium text-slate-900">{p.name} {!p.active && <Badge tone="slate">Inactive</Badge>}</p><p className="text-xs text-slate-500">{p.partnerType} · {p.commissionPct}%{p.city ? ` · ${p.city}` : ""}{p.phone ? ` · ${p.phone}` : ""}</p></td>
                    <td className="px-4 py-2.5 font-mono text-slate-900">{p.referralCode}</td>
                    <td className="px-4 py-2.5 tabular-nums">{p.leads}</td>
                    <td className="px-4 py-2.5 tabular-nums">{p.clients}</td>
                    <td className="px-4 py-2.5 tabular-nums">{formatMoney(p.sales)}</td>
                    <td className="px-4 py-2.5 tabular-nums">{formatMoney(p.commission)}{p.commissionDue > 0 && <p className="text-xs text-amber-700">{formatMoney(p.commissionDue)} due</p>}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right">
                      {p.commissionDue > 0 && <Link href={`/super-admin/subscriptions`} className="mr-1 text-xs text-brand-700 hover:underline">Settle</Link>}
                      <Button variant="ghost" className="px-2 py-1" onClick={() => setEditing(p)} aria-label={`Edit ${p.name}`}><Pencil className="size-3.5" /></Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination pagination={list.q.pagination} onPage={list.setPage} />
      </Card>
      {editing && (
        <SalesForm title={editing === "new" ? "New partner" : `Edit ${editing.name}`} fields={fields} initial={initial(editing === "new" ? undefined : editing)} confirmLabel="Save" onClose={() => setEditing(null)}
          onSubmit={async (v) => {
            if (editing === "new") await api("/api/control/sales/partners", { method: "POST", body: v });
            else await api(`/api/control/sales/partners/${editing.id}`, { method: "PATCH", body: v });
            toast("Partner saved");
            setEditing(null);
            list.q.reload();
          }} />
      )}
    </>
  );
}

/* ======================= coupons ======================= */

interface CouponRow {
  id: string;
  code: string;
  description: string | null;
  kind: string;
  value: number;
  validFrom: string | null;
  validTo: string | null;
  maxUses: number;
  used: number;
  plans: { id: string; name: string }[];
  partner: { id: string; name: string } | null;
  active: boolean;
  status: string;
}

export function CouponsTab() {
  const toast = useToast();
  const options = useSalesOptions();
  const list = useSalesList<CouponRow>("coupons", {});
  const [editing, setEditing] = useState<CouponRow | "new" | null>(null);
  const [deleting, setDeleting] = useState<CouponRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fields: FormField[] = [
    { name: "code", label: "Code", required: true, placeholder: "LAUNCH20", hint: "What the hospital types at checkout" },
    { name: "description", label: "Description", placeholder: "Launch offer" },
    { name: "kind", label: "Discount type", type: "select", options: [{ value: "Percent", label: "Percent off" }, { value: "Flat", label: "Flat ₹ off" }], required: true },
    { name: "value", label: "Discount", type: "number", required: true, hint: "% or ₹, before GST" },
    { name: "validFrom", label: "Valid from", type: "date" },
    { name: "validTo", label: "Valid until", type: "date" },
    { name: "maxUses", label: "Maximum uses", type: "number", hint: "0 = unlimited" },
    { name: "partner", label: "Partner", type: "select", options: (options.data?.partners ?? []).map((p) => ({ value: p.id, label: p.name })), hint: "Sales with this code earn their commission" },
    { name: "plans", label: "Only for plans (none = all)", type: "checklist", options: (options.data?.plans ?? []).filter((p) => !p.trial).map((p) => ({ value: p.id, label: p.name })) },
    { name: "active", label: "Active", type: "checkbox", placeholder: "Can be used" },
  ];
  const initial = (c?: CouponRow): FormValues => ({
    code: c?.code ?? "", description: c?.description ?? "", kind: c?.kind ?? "Percent", value: c ? String(c.value) : "", validFrom: c?.validFrom ?? "", validTo: c?.validTo ?? "",
    maxUses: String(c?.maxUses ?? 0), partner: c?.partner?.id ?? "", plans: c?.plans.map((p) => p.id) ?? [], active: c?.active ?? true,
  });

  async function remove() {
    if (!deleting) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/control/sales/coupons/${deleting.id}`, { method: "DELETE" });
      setDeleting(null);
      list.q.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Card>
        <SearchBar value={list.search} onChange={list.setSearch} placeholder="Coupon code or description…">
          <Button onClick={() => setEditing("new")}><Plus className="size-4" /> New coupon</Button>
        </SearchBar>
        {list.q.error && !list.q.stale ? (
          <ErrorState message={list.q.error} onRetry={list.q.reload} />
        ) : list.q.loading && !list.q.stale ? (
          <Spinner label="Loading coupons…" />
        ) : list.rows.length === 0 ? (
          <EmptyState title={list.filtered ? "No coupons match" : "No coupons yet"} description="Discount codes hospitals enter when they buy or renew a plan in their app." />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead className="bg-slate-50/60"><tr>{["Coupon", "Discount", "Valid", "Used", "Plans", "Status", ""].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-slate-100">
                {list.rows.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-2.5"><p className="flex items-center gap-1 font-mono font-medium text-slate-900"><BadgePercent className="size-4 text-brand-600" />{c.code}</p>{c.description && <p className="text-xs text-slate-500">{c.description}</p>}{c.partner && <p className="text-xs text-slate-500">Partner: {c.partner.name}</p>}</td>
                    <td className="px-4 py-2.5 tabular-nums">{c.kind === "Percent" ? `${c.value}%` : formatMoney(c.value)}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-slate-700">{c.validFrom || c.validTo ? `${c.validFrom ? formatDate(c.validFrom) : "…"} – ${c.validTo ? formatDate(c.validTo) : "…"}` : "Always"}</td>
                    <td className="px-4 py-2.5 tabular-nums">{c.maxUses ? `${c.used} / ${c.maxUses}` : c.used}</td>
                    <td className="px-4 py-2.5 text-slate-700">{c.plans.length ? c.plans.map((p) => p.name).join(", ") : "All plans"}</td>
                    <td className="px-4 py-2.5"><Badge tone={c.status === "Active" ? "green" : c.status === "Scheduled" ? "blue" : "slate"}>{c.status}</Badge></td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right">
                      <Button variant="ghost" className="px-2 py-1" onClick={() => setEditing(c)} aria-label={`Edit ${c.code}`}><Pencil className="size-3.5" /></Button>
                      {c.used === 0 && <Button variant="ghost" className="px-2 py-1" onClick={() => { setError(null); setDeleting(c); }} aria-label={`Delete ${c.code}`}><Trash2 className="size-3.5" /></Button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination pagination={list.q.pagination} onPage={list.setPage} />
      </Card>
      {editing && (
        <SalesForm title={editing === "new" ? "New coupon" : `Edit ${editing.code}`} fields={fields} initial={initial(editing === "new" ? undefined : editing)} confirmLabel="Save" onClose={() => setEditing(null)}
          onSubmit={async (v) => {
            if (editing === "new") await api("/api/control/sales/coupons", { method: "POST", body: v });
            else await api(`/api/control/sales/coupons/${editing.id}`, { method: "PATCH", body: v });
            toast("Coupon saved");
            setEditing(null);
            list.q.reload();
          }} />
      )}
      <ConfirmDialog open={!!deleting} title={`Delete coupon ${deleting?.code}?`} message="Only unused coupons can be deleted." confirmLabel="Delete" danger loading={busy} error={error} onConfirm={remove} onClose={() => setDeleting(null)} />
    </>
  );
}

export const SALES_TABS = [
  { key: "overview", label: "Overview", icon: TrendingUp },
  { key: "leads", label: "Leads", icon: UserPlus },
  { key: "partners", label: "Partners", icon: Handshake },
  { key: "coupons", label: "Coupons", icon: BadgePercent },
] as const;

