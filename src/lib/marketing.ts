import "server-only";
import type { Types } from "mongoose";
import { ApiError } from "./api";
import { r2 } from "./billing-math";
import { LEAD_SOURCES, LEAD_STATUSES } from "./modules";
import { getRecordModel } from "@/models/records";

/**
 * Marketing overview: the lead funnel, which sources and campaigns bring
 * patients (and at what cost), follow-ups due and patient feedback scores.
 * The records themselves are generic resources of the "marketing" module.
 */

type Doc = Record<string, unknown> & { _id: Types.ObjectId };

const M = (r: string) => getRecordModel("marketing", r)!;
const DAY = 86_400_000;
const OPEN = { status: { $nin: ["Converted", "Not interested", "Lost"] } };

function today() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function parseDay(v: string | null): Date | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

const pct = (part: number, whole: number) => (whole ? r2((part / whole) * 100) : null);
const iso = (d: unknown) => (d instanceof Date ? d.toISOString().slice(0, 10) : null);

/** ?from=&to= (enquiry / feedback dates; defaults to the last 30 days). */
export async function marketingOverview(url: URL) {
  const to = parseDay(url.searchParams.get("to")) ?? today();
  const from = parseDay(url.searchParams.get("from")) ?? new Date(to.getTime() - 29 * DAY);
  if (from > to) throw new ApiError(422, "From date must be before To date");
  const range = { $gte: from, $lte: to };

  const [leads, due, campaigns, feedback] = await Promise.all([
    M("leads").find({ enquiryDate: range }).select("status source campaign referrer").populate({ path: "referrer", select: "name partnerType" }).lean<Doc[]>(),
    M("leads").find({ ...OPEN, nextFollowUp: { $lte: today() } }).sort({ nextFollowUp: 1 }).limit(25)
      .select("code fullName mobile interestedIn status nextFollowUp assignedTo").populate({ path: "assignedTo", select: "fullName" }).lean<Doc[]>(),
    M("campaigns").find({ startDate: { $lte: to }, $or: [{ endDate: null }, { endDate: { $exists: false } }, { endDate: { $gte: from } }] }).sort({ startDate: -1 }).limit(50).lean<Doc[]>(),
    M("feedback").find({ receivedOn: range }).select("rating recommend status").lean<Doc[]>(),
  ]);
  const dueCount = await M("leads").countDocuments({ ...OPEN, nextFollowUp: { $lte: today() } });

  const converted = (rows: Doc[]) => rows.filter((l) => l.status === "Converted").length;
  const bySource = LEAD_SOURCES.map((source) => {
    const rows = leads.filter((l) => l.source === source);
    return { source, leads: rows.length, converted: converted(rows), conversionPct: pct(converted(rows), rows.length) };
  }).filter((s) => s.leads > 0).sort((a, b) => b.leads - a.leads);

  // Campaign results count every lead tagged to the campaign, not just this period's.
  const campaignIds = campaigns.map((c) => c._id);
  const tagged = campaignIds.length
    ? await M("leads").aggregate<{ _id: Types.ObjectId; leads: number; converted: number }>([
        { $match: { campaign: { $in: campaignIds } } },
        { $group: { _id: "$campaign", leads: { $sum: 1 }, converted: { $sum: { $cond: [{ $eq: ["$status", "Converted"] }, 1, 0] } } } },
      ])
    : [];
  const tagMap = new Map(tagged.map((t) => [String(t._id), t]));
  const campaignRows = campaigns.map((c) => {
    const t = tagMap.get(String(c._id));
    const spent = typeof c.spent === "number" ? c.spent : 0;
    const n = t?.leads ?? 0;
    const won = t?.converted ?? 0;
    return {
      id: String(c._id), code: (c.code as string) ?? "", name: String(c.name), channel: String(c.channel), status: String(c.status), startDate: iso(c.startDate), endDate: iso(c.endDate),
      spent, budget: typeof c.budget === "number" ? c.budget : null, targetLeads: typeof c.targetLeads === "number" ? c.targetLeads : null,
      leads: n, converted: won, costPerLead: n && spent ? r2(spent / n) : null, costPerConversion: won && spent ? r2(spent / won) : null,
    };
  });

  const partners = new Map<string, { name: string; type: string; leads: number; converted: number }>();
  for (const l of leads) {
    const p = l.referrer && typeof l.referrer === "object" ? (l.referrer as Doc) : null;
    if (!p) continue;
    const row = partners.get(String(p._id)) ?? { name: String(p.name), type: String(p.partnerType ?? ""), leads: 0, converted: 0 };
    row.leads++;
    if (l.status === "Converted") row.converted++;
    partners.set(String(p._id), row);
  }

  const ratings = feedback.map((f) => Number(f.rating)).filter((n) => n >= 1 && n <= 5);
  const scores = feedback.map((f) => f.recommend).filter((n): n is number => typeof n === "number");
  const promoters = scores.filter((n) => n >= 9).length;
  const detractors = scores.filter((n) => n <= 6).length;

  return {
    from: iso(from),
    to: iso(to),
    totals: {
      leads: leads.length,
      converted: converted(leads),
      conversionPct: pct(converted(leads), leads.length),
      open: leads.filter((l) => !["Converted", "Not interested", "Lost"].includes(String(l.status))).length,
      followUpsDue: dueCount,
      feedback: feedback.length,
      avgRating: ratings.length ? r2(ratings.reduce((s, n) => s + n, 0) / ratings.length) : null,
      nps: scores.length ? Math.round(((promoters - detractors) / scores.length) * 100) : null,
      openComplaints: feedback.filter((f) => Number(f.rating) <= 2 && (f.status === "New" || f.status === "Acknowledged")).length,
    },
    funnel: LEAD_STATUSES.map((status) => ({ status, count: leads.filter((l) => l.status === status).length })),
    bySource,
    campaigns: campaignRows,
    partners: [...partners.values()].sort((a, b) => b.leads - a.leads).slice(0, 10),
    due: due.map((l) => ({
      id: String(l._id), code: (l.code as string) ?? "", name: String(l.fullName), mobile: (l.mobile as string) ?? "", interestedIn: (l.interestedIn as string) ?? "", status: String(l.status),
      nextFollowUp: iso(l.nextFollowUp), overdueDays: l.nextFollowUp instanceof Date ? Math.round((today().getTime() - l.nextFollowUp.getTime()) / DAY) : 0,
      assignedTo: l.assignedTo && typeof l.assignedTo === "object" ? String((l.assignedTo as Doc).fullName) : null,
    })),
  };
}
