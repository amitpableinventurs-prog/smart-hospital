"use client";

import { CalendarClock, MessageSquareHeart, TrendingUp, UserPlus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { qs } from "@/lib/client";
import { formatDate, formatMoney } from "@/lib/format";
import { useApiQuery } from "@/lib/useApi";
import { TableCard } from "../TableCard";
import { Badge, Card, CardHeader, ErrorState, Spinner, StatCard, inputClass, statusTone } from "../ui";

/** Bespoke Marketing tab: the overview. Leads, campaigns etc. use the generic record screens. */
export function MarketingSection({ section }: { section: string }) {
  return section === "overview" ? <Overview /> : null;
}

interface OverviewData {
  from: string;
  to: string;
  totals: { leads: number; converted: number; conversionPct: number | null; open: number; followUpsDue: number; feedback: number; avgRating: number | null; nps: number | null; openComplaints: number };
  funnel: { status: string; count: number }[];
  bySource: { source: string; leads: number; converted: number; conversionPct: number | null }[];
  campaigns: { id: string; code: string; name: string; channel: string; status: string; spent: number; budget: number | null; targetLeads: number | null; leads: number; converted: number; costPerLead: number | null; costPerConversion: number | null }[];
  partners: { name: string; type: string; leads: number; converted: number }[];
  due: { id: string; code: string; name: string; mobile: string; interestedIn: string; status: string; nextFollowUp: string | null; overdueDays: number; assignedTo: string | null }[];
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const pctText = (n: number | null) => (n === null ? "—" : `${n}%`);

function Overview() {
  const [to, setTo] = useState(() => isoDay(new Date()));
  const [from, setFrom] = useState(() => isoDay(new Date(Date.now() - 29 * 86_400_000)));
  const q = useApiQuery<OverviewData>(`/api/marketing/overview${qs({ from, to })}`);
  const d = q.data ?? q.stale;

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center gap-3 p-4">
        <span className="text-sm font-medium text-slate-700">Enquiries from</span>
        <input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} className={`${inputClass} w-auto`} aria-label="From" />
        <span className="text-sm text-slate-500">to</span>
        <input type="date" value={to} min={from} max={isoDay(new Date())} onChange={(e) => e.target.value && setTo(e.target.value)} className={`${inputClass} w-auto`} aria-label="To" />
      </Card>
      {q.error && !d ? (
        <ErrorState message={q.error} onRetry={q.reload} />
      ) : !d ? (
        <Spinner label="Loading overview…" />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Leads" value={d.totals.leads} hint={`${d.totals.open} still open`} icon={<UserPlus className="size-5" />} />
            <StatCard label="Converted" value={d.totals.converted} hint={`Conversion ${pctText(d.totals.conversionPct)}`} icon={<TrendingUp className="size-5" />} />
            <StatCard label="Follow-ups due" value={d.totals.followUpsDue} hint="Today and overdue" tone={d.totals.followUpsDue ? "amber" : "slate"} icon={<CalendarClock className="size-5" />} />
            <StatCard
              label="Patient rating"
              value={d.totals.avgRating === null ? "—" : `${d.totals.avgRating} / 5`}
              hint={`${d.totals.feedback} response(s)${d.totals.nps !== null ? ` · NPS ${d.totals.nps}` : ""}${d.totals.openComplaints ? ` · ${d.totals.openComplaints} open complaint(s)` : ""}`}
              tone={d.totals.openComplaints ? "red" : "brand"}
              icon={<MessageSquareHeart className="size-5" />}
            />
          </div>

          <Card>
            <CardHeader title="Follow-ups due" description="Open leads whose next follow-up is today or earlier." actions={<Link href="/m/marketing?tab=followups" className="text-sm font-medium text-brand-700 hover:underline">Log a follow-up</Link>} />
            {d.due.length === 0 ? (
              <p className="px-5 py-4 text-sm text-slate-500">Nothing is due.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-100 text-sm">
                  <thead><tr>{["Lead", "Interested in", "Status", "Due", "Assigned to"].map((h) => <th key={h} className="whitespace-nowrap px-5 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">{h}</th>)}</tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {d.due.map((l) => (
                      <tr key={l.id}>
                        <td className="px-5 py-2"><span className="font-medium text-slate-900">{l.name}</span> <span className="font-mono text-xs text-slate-500">{l.code}</span><div className="text-xs text-slate-500">{l.mobile}</div></td>
                        <td className="px-5 py-2 text-slate-700">{l.interestedIn}</td>
                        <td className="px-5 py-2"><Badge tone={statusTone(l.status)}>{l.status}</Badge></td>
                        <td className="whitespace-nowrap px-5 py-2">{l.overdueDays > 0 ? <span className="font-medium text-red-700">{l.overdueDays} day(s) overdue</span> : <span className="text-amber-700">Today</span>}<div className="text-xs text-slate-500">{formatDate(l.nextFollowUp)}</div></td>
                        <td className="px-5 py-2 text-slate-700">{l.assignedTo ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <TableCard title="Lead funnel" description={`Enquiries ${formatDate(d.from)} – ${formatDate(d.to)} by current status`} headers={["Status", "Leads", "Share"]} empty="No leads in this period."
              rows={d.totals.leads ? d.funnel.map((f) => [f.status, f.count, pctText(d.totals.leads ? Math.round((f.count / d.totals.leads) * 1000) / 10 : null)]) : []} />
            <TableCard title="Where leads come from" headers={["Source", "Leads", "Converted", "Conversion"]} empty="No leads in this period."
              rows={d.bySource.map((s) => [s.source, s.leads, s.converted, pctText(s.conversionPct)])} />
          </div>

          <TableCard
            title="Campaign performance"
            description="Campaigns running in this period. Leads and conversions count every lead tagged with the campaign."
            headers={["Campaign", "Status", "Spent", "Leads", "Converted", "Cost / lead", "Cost / conversion"]}
            empty="No campaigns in this period. Add them under Campaigns."
            rows={d.campaigns.map((c) => [
              <span key="n"><span className="font-medium">{c.name}</span> <span className="text-xs text-slate-500">{c.channel}</span></span>,
              <Badge key="s" tone={statusTone(c.status)}>{c.status}</Badge>,
              formatMoney(c.spent),
              c.targetLeads ? `${c.leads} / ${c.targetLeads}` : c.leads,
              c.converted,
              c.costPerLead === null ? "—" : formatMoney(c.costPerLead),
              c.costPerConversion === null ? "—" : formatMoney(c.costPerConversion),
            ])}
          />

          <TableCard title="Top referral partners" description="By leads referred in this period." headers={["Partner", "Leads", "Converted"]} empty="No referred leads in this period."
            rows={d.partners.map((p) => [<span key="p">{p.name} <span className="text-xs text-slate-500">{p.type}</span></span>, p.leads, p.converted])} />
        </>
      )}
    </div>
  );
}
