import "server-only";
import { Types } from "mongoose";
import { GSTIN_RE, GST_STATES, stateCodeOf } from "./accounts-shared";
import { ensurePosted, hospitalState, loadChart, parseDay } from "./accounts";
import { ApiError } from "./api";
import { r2 } from "./billing-math";
import { orgInfo } from "./org";
import { Voucher } from "@/models/accounts";
import { Trip } from "@/models/ambulance";
import { Bill } from "@/models/billing";
import { StockDoc } from "@/models/inventory";
import { LabOrder } from "@/models/laboratory";
import { Purchase, Sale } from "@/models/pharmacy";
import { getRecordModel } from "@/models/records";

/**
 * GST returns built from the source documents: GSTR-1 (with the JSON the GST
 * portal's offline tool imports), GSTR-3B and the purchase / ITC register.
 *
 * Classification used for a hospital:
 *   - pharmacy sales: goods, B2C, intra-state; 0% items are nil-rated
 *   - hospital bills: services; B2B when the bill's corporate payer has a
 *     GSTIN, otherwise B2C; 0% lines are exempt healthcare services
 *   - lab orders and directly collected ambulance trips: exempt services
 */

type Doc = Record<string, unknown> & { _id: Types.ObjectId };

const DAY = 86400_000;
/** Default SAC for healthcare services that have none in the Service Master. */
const HEALTH_SAC = "9993";

interface Period {
  from: Date;
  end: Date;
  /** "MMYYYY" return period, when the range is one calendar month. */
  fp: string | null;
  label: string;
}

/** ?month=YYYY-MM (a return period) or ?from=&to=. */
function period(url: URL): Period {
  const month = url.searchParams.get("month");
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    const [y, m] = month.split("-").map(Number);
    if (m < 1 || m > 12) throw new ApiError(422, "Choose a valid month");
    const from = new Date(Date.UTC(y, m - 1, 1));
    const end = new Date(Date.UTC(y, m, 1) - 1);
    return { from, end, fp: `${String(m).padStart(2, "0")}${y}`, label: from.toLocaleString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }) };
  }
  const from = parseDay(url.searchParams.get("from"));
  const to = parseDay(url.searchParams.get("to"));
  if (!from || !to) throw new ApiError(422, "Choose the return month");
  if (from > to) throw new ApiError(422, "From date must be before To date");
  return { from, end: new Date(to.getTime() + DAY - 1), fp: null, label: `${from.toISOString().slice(0, 10)} to ${to.toISOString().slice(0, 10)}` };
}

interface Item {
  hsn: string;
  desc: string;
  uqc: string;
  qty: number;
  rate: number;
  taxable: number;
  tax: number;
  /** 0% supplies: nil-rated goods or exempt services. */
  zero?: "nil" | "exempt";
  defaultHsn?: boolean;
}

interface Invoice {
  source: "Pharmacy" | "Hospital" | "Laboratory" | "Ambulance";
  id: string;
  code: string;
  date: Date;
  value: number;
  party: string;
  ctin: string | null;
  pos: string;
  inter: boolean;
  items: Item[];
}

/** Split tax by place of supply. */
function heads(tax: number, inter: boolean) {
  if (inter) return { iamt: r2(tax), camt: 0, samt: 0 };
  const camt = r2(tax / 2);
  return { iamt: 0, camt, samt: r2(tax - camt) };
}

async function outward(p: Period, home: string): Promise<{ invoices: Invoice[]; cancelled: { series: string; code: string }[]; all: { series: string; code: string }[] }> {
  const range = { $gte: p.from, $lte: p.end };
  const [sales, bills, labs, trips] = await Promise.all([
    Sale.find({ billDate: range }).lean<Doc[]>(),
    Bill.find({ billDate: range, status: { $in: ["Final", "Closed", "Cancelled"] } }).lean<Doc[]>(),
    LabOrder.find({ orderDate: range }).select("code orderDate status patientName netAmount").lean<Doc[]>(),
    Trip.find({ billingMode: "Collect", status: "Completed", completedAt: range }).select("code completedAt patientName callerName charges").lean<Doc[]>(),
  ]);

  const serviceIds = [...new Set(bills.flatMap((b) => (b.lines as Doc[]).map((l) => l.service).filter(Boolean).map(String)))];
  const services = new Map((await getRecordModel("billing", "services")!.find({ _id: { $in: serviceIds } }).select("sacCode").lean<Doc[]>()).map((s) => [String(s._id), String(s.sacCode ?? "").trim()]));
  const corpIds = [...new Set(bills.map((b) => b.corporate).filter(Boolean).map(String))];
  const corps = new Map((await getRecordModel("billing", "corporates")!.find({ _id: { $in: corpIds } }).select("name gstin").lean<Doc[]>()).map((c) => [String(c._id), c]));

  const invoices: Invoice[] = [];
  const all: { series: string; code: string }[] = [];
  const cancelled: { series: string; code: string }[] = [];
  const track = (series: string, code: string, isCancelled: boolean) => {
    all.push({ series, code });
    if (isCancelled) cancelled.push({ series, code });
  };

  for (const s of sales) {
    track("Pharmacy", String(s.code), s.status === "Cancelled");
    if (s.status === "Cancelled") continue;
    invoices.push({
      source: "Pharmacy", id: String(s._id), code: String(s.code), date: s.billDate as Date, value: Number(s.netAmount ?? 0), party: String(s.customerName ?? ""), ctin: null, pos: home, inter: false,
      items: (s.items as Doc[]).map((l) => {
        const hsn = String(l.hsnCode ?? "").trim();
        const rate = Number(l.gstRate ?? 0);
        return { hsn, desc: String(l.itemName ?? ""), uqc: "NOS", qty: Number(l.qty ?? 0), rate, taxable: Number(l.taxable ?? 0), tax: Number(l.gst ?? 0), zero: rate === 0 ? "nil" : undefined };
      }),
    });
  }

  for (const b of bills) {
    track("Hospital", String(b.code), b.status === "Cancelled");
    if (b.status === "Cancelled") continue;
    const corp = b.payerType === "Corporate" && b.corporate ? corps.get(String(b.corporate)) : undefined;
    const gstin = typeof corp?.gstin === "string" ? corp.gstin.trim().toUpperCase() : "";
    const ctin = GSTIN_RE.test(gstin) ? gstin : null;
    const pos = ctin ? stateCodeOf(ctin) : home;
    invoices.push({
      source: "Hospital", id: String(b._id), code: String(b.code), date: b.billDate as Date, value: Number(b.netAmount ?? 0), party: ctin ? String(corp?.name ?? b.payerName ?? "") : String(b.patientName ?? ""), ctin, pos, inter: !!home && pos !== home,
      items: (b.lines as Doc[])
        .filter((l) => l.status !== "Cancelled")
        .map((l) => {
          const sac = (l.service ? services.get(String(l.service)) : "") || "";
          const rate = Number(l.gstRate ?? 0);
          return { hsn: sac || HEALTH_SAC, defaultHsn: !sac, desc: String(l.category ?? l.name ?? ""), uqc: "NA", qty: 0, rate, taxable: Number(l.taxable ?? 0), tax: Number(l.gst ?? 0), zero: rate === 0 ? "exempt" : undefined };
        }),
    });
  }

  for (const o of labs) {
    track("Laboratory", String(o.code), o.status === "Cancelled");
    const net = Number(o.netAmount ?? 0);
    if (o.status === "Cancelled" || net <= 0) continue;
    invoices.push({ source: "Laboratory", id: String(o._id), code: String(o.code), date: o.orderDate as Date, value: net, party: String(o.patientName ?? ""), ctin: null, pos: home, inter: false, items: [{ hsn: HEALTH_SAC, desc: "Laboratory services", uqc: "NA", qty: 0, rate: 0, taxable: net, tax: 0, zero: "exempt" }] });
  }

  for (const t of trips) {
    const total = Number((t.charges as { total?: number } | undefined)?.total ?? 0);
    track("Ambulance", String(t.code), false);
    if (total <= 0) continue;
    invoices.push({ source: "Ambulance", id: String(t._id), code: String(t.code), date: t.completedAt as Date, value: total, party: String(t.patientName || t.callerName || ""), ctin: null, pos: home, inter: false, items: [{ hsn: HEALTH_SAC, desc: "Ambulance services", uqc: "NA", qty: 0, rate: 0, taxable: total, tax: 0, zero: "exempt" }] });
  }

  return { invoices, cancelled, all };
}

/** Manual vouchers that touch the GST ledgers (sales / purchases entered directly in Accounts). */
async function manualGst(p: Period) {
  const chart = await loadChart();
  const key = (id: string) => chart.ledgers.get(id)?.systemKey ?? "";
  const vouchers = await Voucher.find({ auto: { $ne: true }, status: "Active", date: { $gte: p.from, $lte: p.end } }).lean<Doc[]>();
  const out = { taxable: 0, iamt: 0, camt: 0, samt: 0 };
  const itc = { taxable: 0, iamt: 0, camt: 0, samt: 0 };
  const purchases: { id: string; code: string; date: Date; party: string; gstin: string | null; refNo: string; taxable: number; iamt: number; camt: number; samt: number }[] = [];
  for (const v of vouchers) {
    const entries = v.entries as { ledger: Types.ObjectId; dr: number; cr: number }[];
    const amt = (k: string, side: 1 | -1) => r2(entries.filter((e) => key(String(e.ledger)) === k).reduce((s, e) => s + side * (e.cr - e.dr), 0));
    const o = { iamt: amt("output_igst", 1), camt: amt("output_cgst", 1), samt: amt("output_sgst", 1) };
    const i = { iamt: amt("input_igst", -1), camt: amt("input_cgst", -1), samt: amt("input_sgst", -1) };
    if (o.iamt || o.camt || o.samt) {
      const taxable = r2(entries.filter((e) => ["Income"].includes(chart.ledgers.get(String(e.ledger))?.nature ?? "")).reduce((s, e) => s + e.cr - e.dr, 0));
      out.taxable = r2(out.taxable + taxable);
      out.iamt = r2(out.iamt + o.iamt);
      out.camt = r2(out.camt + o.camt);
      out.samt = r2(out.samt + o.samt);
    }
    if (i.iamt || i.camt || i.samt) {
      const taxable = r2(entries.filter((e) => ["Expenses", "Assets"].includes(chart.ledgers.get(String(e.ledger))?.nature ?? "") && !key(String(e.ledger)).startsWith("input_")).reduce((s, e) => s + e.dr - e.cr, 0));
      const partyEntry = entries.find((e) => {
        const l = chart.ledgers.get(String(e.ledger));
        return l && (l.path.includes("creditors") || l.path.includes("cash") || l.path.includes("bank"));
      });
      const party = partyEntry ? chart.ledgers.get(String(partyEntry.ledger)) : undefined;
      itc.taxable = r2(itc.taxable + taxable);
      itc.iamt = r2(itc.iamt + i.iamt);
      itc.camt = r2(itc.camt + i.camt);
      itc.samt = r2(itc.samt + i.samt);
      purchases.push({ id: String(v._id), code: String(v.code), date: v.date as Date, party: party?.name ?? "", gstin: party?.gstin ?? null, refNo: String(v.refNo ?? ""), taxable, ...i });
    }
  }
  return { out, itc, purchases };
}

function seriesOf(code: string) {
  return code.replace(/\d+$/, "");
}

function docsIssued(all: { series: string; code: string }[], cancelled: { series: string; code: string }[]) {
  const groups = new Map<string, string[]>();
  for (const d of all) {
    const k = `${d.series}|${seriesOf(d.code)}`;
    groups.set(k, [...(groups.get(k) ?? []), d.code]);
  }
  return [...groups].map(([k, codes]) => {
    const sorted = codes.sort();
    const c = cancelled.filter((x) => `${x.series}|${seriesOf(x.code)}` === k).length;
    return { series: k.split("|")[0], from: sorted[0], to: sorted[sorted.length - 1], total: sorted.length, cancelled: c, net: sorted.length - c };
  });
}

interface HsnRow {
  hsn: string;
  desc: string;
  uqc: string;
  qty: number;
  rate: number;
  taxable: number;
  iamt: number;
  camt: number;
  samt: number;
}

function hsnSummary(invoices: Invoice[]) {
  const map = new Map<string, HsnRow>();
  for (const inv of invoices) {
    for (const it of inv.items) {
      if (!it.hsn) continue;
      const k = `${it.hsn}|${it.rate}|${it.uqc}`;
      const row = map.get(k) ?? { hsn: it.hsn, desc: it.desc.slice(0, 30), uqc: it.uqc, qty: 0, rate: it.rate, taxable: 0, iamt: 0, camt: 0, samt: 0 };
      const h = heads(it.tax, inv.inter);
      row.qty = r2(row.qty + it.qty);
      row.taxable = r2(row.taxable + it.taxable);
      row.iamt = r2(row.iamt + h.iamt);
      row.camt = r2(row.camt + h.camt);
      row.samt = r2(row.samt + h.samt);
      map.set(k, row);
    }
  }
  return [...map.values()].sort((a, b) => a.hsn.localeCompare(b.hsn) || a.rate - b.rate);
}

async function context(url: URL) {
  await ensurePosted();
  const p = period(url);
  const home = await hospitalState();
  const gstin = (orgInfo().gstin || "").trim().toUpperCase();
  return { p, home, gstin };
}

export async function gstr1(url: URL) {
  const { p, home, gstin } = await context(url);
  const { invoices, cancelled, all } = await outward(p, home);
  const warnings: string[] = [];
  if (!GSTIN_RE.test(gstin)) warnings.push("The hospital GSTIN is not set (Control Panel → Branding, or HOSPITAL_GSTIN). It is needed for the GSTR-1 JSON.");
  if (!home) warnings.push("The hospital's state is unknown — set the GSTIN or choose the state in Accounts Settings.");

  const b2bMap = new Map<string, { ctin: string; party: string; invoices: { id: string; code: string; date: string; value: number; pos: string; taxable: number; iamt: number; camt: number; samt: number; rates: { rate: number; taxable: number; iamt: number; camt: number; samt: number }[] }[] }>();
  const b2cs = new Map<string, { type: "INTRA" | "INTER"; pos: string; rate: number; taxable: number; iamt: number; camt: number; samt: number }>();
  const nil = { INTRAB2B: { nil: 0, exempt: 0 }, INTRB2B: { nil: 0, exempt: 0 }, INTRAB2C: { nil: 0, exempt: 0 }, INTRB2C: { nil: 0, exempt: 0 } };
  let missingHsn = 0;
  let defaultSac = 0;

  for (const inv of invoices) {
    const taxed = inv.items.filter((i) => !i.zero && i.rate > 0);
    const zero = inv.items.filter((i) => i.zero || i.rate === 0);
    const nilKey = `${inv.inter ? "INTR" : "INTRA"}${inv.ctin ? "B2B" : "B2C"}` as keyof typeof nil;
    for (const z of zero) nil[nilKey][z.zero === "nil" ? "nil" : "exempt"] = r2(nil[nilKey][z.zero === "nil" ? "nil" : "exempt"] + z.taxable);
    missingHsn += inv.items.filter((i) => !i.hsn).length;
    defaultSac += inv.items.filter((i) => i.defaultHsn).length;
    if (!taxed.length) continue;
    const byRate = new Map<number, { rate: number; taxable: number; iamt: number; camt: number; samt: number }>();
    for (const it of taxed) {
      const h = heads(it.tax, inv.inter);
      const r = byRate.get(it.rate) ?? { rate: it.rate, taxable: 0, iamt: 0, camt: 0, samt: 0 };
      r.taxable = r2(r.taxable + it.taxable);
      r.iamt = r2(r.iamt + h.iamt);
      r.camt = r2(r.camt + h.camt);
      r.samt = r2(r.samt + h.samt);
      byRate.set(it.rate, r);
    }
    const rates = [...byRate.values()];
    if (inv.ctin) {
      const party = b2bMap.get(inv.ctin) ?? { ctin: inv.ctin, party: inv.party, invoices: [] };
      party.invoices.push({
        id: inv.id, code: inv.code, date: inv.date.toISOString(), value: inv.value, pos: inv.pos,
        taxable: r2(rates.reduce((s, r) => s + r.taxable, 0)), iamt: r2(rates.reduce((s, r) => s + r.iamt, 0)), camt: r2(rates.reduce((s, r) => s + r.camt, 0)), samt: r2(rates.reduce((s, r) => s + r.samt, 0)), rates,
      });
      b2bMap.set(inv.ctin, party);
    } else {
      for (const r of rates) {
        const k = `${inv.inter ? "INTER" : "INTRA"}|${inv.pos}|${r.rate}`;
        const row = b2cs.get(k) ?? { type: inv.inter ? "INTER" : "INTRA", pos: inv.pos, rate: r.rate, taxable: 0, iamt: 0, camt: 0, samt: 0 };
        row.taxable = r2(row.taxable + r.taxable);
        row.iamt = r2(row.iamt + r.iamt);
        row.camt = r2(row.camt + r.camt);
        row.samt = r2(row.samt + r.samt);
        b2cs.set(k, row);
      }
    }
  }
  if (missingHsn) warnings.push(`${missingHsn} pharmacy line(s) have no HSN code and are left out of the HSN summary — add HSN codes in Inventory → Item Master.`);
  if (defaultSac) warnings.push(`${defaultSac} hospital charge line(s) have no SAC in the Service Master; SAC ${HEALTH_SAC} (health services) was used.`);
  const longCodes = invoices.filter((i) => i.code.length > 16).length;
  if (longCodes) warnings.push(`${longCodes} invoice number(s) are longer than the 16 characters the GST portal allows.`);

  const b2b = [...b2bMap.values()];
  const b2csRows = [...b2cs.values()].sort((a, b) => a.pos.localeCompare(b.pos) || a.rate - b.rate);
  const hsnB2b = hsnSummary(invoices.filter((i) => i.ctin));
  const hsnB2c = hsnSummary(invoices.filter((i) => !i.ctin));
  const total = (rows: { taxable: number; iamt: number; camt: number; samt: number }[]) => ({
    taxable: r2(rows.reduce((s, r) => s + r.taxable, 0)), iamt: r2(rows.reduce((s, r) => s + r.iamt, 0)), camt: r2(rows.reduce((s, r) => s + r.camt, 0)), samt: r2(rows.reduce((s, r) => s + r.samt, 0)),
  });
  const nilRows = (Object.keys(nil) as (keyof typeof nil)[]).map((k) => ({ type: k, label: { INTRAB2B: "Intra-state to registered", INTRB2B: "Inter-state to registered", INTRAB2C: "Intra-state to unregistered", INTRB2C: "Inter-state to unregistered" }[k], ...nil[k] }));

  return {
    period: p.label,
    fp: p.fp,
    gstin,
    state: home ? `${home} - ${GST_STATES[home]}` : "",
    warnings,
    summary: {
      b2b: { invoices: b2b.reduce((s, x) => s + x.invoices.length, 0), ...total(b2b.flatMap((x) => x.invoices)) },
      b2cs: total(b2csRows),
      nil: r2(nilRows.reduce((s, r) => s + r.nil, 0)),
      exempt: r2(nilRows.reduce((s, r) => s + r.exempt, 0)),
      invoices: invoices.length,
      value: r2(invoices.reduce((s, i) => s + i.value, 0)),
    },
    b2b,
    b2cs: b2csRows,
    nil: nilRows,
    hsnB2b,
    hsnB2c,
    docs: docsIssued(all, cancelled),
  };
}

const idt = (isoDate: string) => `${isoDate.slice(8, 10)}-${isoDate.slice(5, 7)}-${isoDate.slice(0, 4)}`;

/** GSTR-1 in the JSON layout the GST portal's offline tool imports. */
export async function gstr1Json(url: URL) {
  const r = await gstr1(url);
  if (!r.fp) throw new ApiError(422, "The JSON is made for one return month — choose a month");
  if (!GSTIN_RE.test(r.gstin)) throw new ApiError(422, "Set the hospital GSTIN first (Control Panel → Branding, or HOSPITAL_GSTIN)");
  const amounts = (x: { iamt: number; camt: number; samt: number }, inter: boolean) => (inter ? { iamt: x.iamt, csamt: 0 } : { camt: x.camt, samt: x.samt, csamt: 0 });
  const hsnRows = (rows: HsnRow[]) =>
    rows.map((h, i) => ({ num: i + 1, hsn_sc: h.hsn, desc: h.desc, uqc: h.uqc, qty: h.qty, rt: h.rate, txval: h.taxable, iamt: h.iamt, camt: h.camt, samt: h.samt, csamt: 0 }));
  const json: Record<string, unknown> = { gstin: r.gstin, fp: r.fp, version: "GST3.2.4", hash: "hash" };
  if (r.b2b.length) {
    json.b2b = r.b2b.map((p) => ({
      ctin: p.ctin,
      inv: p.invoices.map((inv) => {
        const inter = inv.pos !== r.state.slice(0, 2);
        return {
          inum: inv.code, idt: idt(inv.date), val: inv.value, pos: inv.pos, rchrg: "N", inv_typ: "R",
          itms: inv.rates.map((x) => ({ num: Math.round(x.rate * 100) + 1, itm_det: { rt: x.rate, txval: x.taxable, ...amounts(x, inter) } })),
        };
      }),
    }));
  }
  if (r.b2cs.length) json.b2cs = r.b2cs.map((x) => ({ sply_ty: x.type, pos: x.pos, typ: "OE", rt: x.rate, txval: x.taxable, ...amounts(x, x.type === "INTER") }));
  const nil = r.nil.filter((n) => n.nil || n.exempt).map((n) => ({ sply_ty: n.type, nil_amt: n.nil, expt_amt: n.exempt, ngsup_amt: 0 }));
  if (nil.length) json.nil = { inv: nil };
  const hsn: Record<string, unknown> = {};
  if (r.hsnB2b.length) hsn.hsn_b2b = hsnRows(r.hsnB2b);
  if (r.hsnB2c.length) hsn.hsn_b2c = hsnRows(r.hsnB2c);
  if (Object.keys(hsn).length) json.hsn = hsn;
  if (r.docs.length) {
    json.doc_issue = { doc_det: [{ doc_num: 1, doc_typ: "Invoices for outward supply", docs: r.docs.map((d, i) => ({ num: i + 1, from: d.from, to: d.to, totnum: d.total, cancel: d.cancelled, net_issue: d.net })) }] };
  }
  return { filename: `GSTR1_${r.gstin}_${r.fp}.json`, json };
}

/* ---------- inward supplies / ITC ---------- */

async function inward(p: Period, home: string) {
  const range = { $gte: p.from, $lte: p.end };
  const [purchases, docs] = await Promise.all([
    Purchase.find({ invoiceDate: range, status: { $ne: "Cancelled" } }).lean<Doc[]>(),
    StockDoc.find({ status: "Posted", $or: [{ type: "grn", $or: [{ invoiceDate: range }, { invoiceDate: null, docDate: range }] }, { type: "purchase_return", docDate: range }] }).lean<Doc[]>(),
  ]);
  const againstIds = docs.filter((d) => d.type === "purchase_return" && !d.supplier && d.against).map((d) => d.against);
  const against = new Map((await StockDoc.find({ _id: { $in: againstIds } }).select("supplier").lean<Doc[]>()).map((d) => [String(d._id), d.supplier]));
  const supplierIds = [...new Set([...purchases.map((x) => x.supplier), ...docs.map((d) => d.supplier ?? against.get(String(d.against)))].filter(Boolean).map(String))];
  const suppliers = new Map((await getRecordModel("inventory", "suppliers")!.find({ _id: { $in: supplierIds } }).select("name gstin").lean<Doc[]>()).map((s) => [String(s._id), s]));

  const rows: { kind: string; id: string; code: string; date: string; party: string; gstin: string | null; invoiceNo: string; taxable: number; iamt: number; camt: number; samt: number; total: number; eligible: boolean; href: string | null }[] = [];
  const push = (kind: string, id: string, code: string, date: Date, supplierId: unknown, fallbackName: string, invoiceNo: string, taxable: number, gst: number, total: number, sign: 1 | -1, href: string | null) => {
    const s = supplierId ? suppliers.get(String(supplierId)) : undefined;
    const g = typeof s?.gstin === "string" ? s.gstin.trim().toUpperCase() : "";
    const gstin = GSTIN_RE.test(g) ? g : null;
    const st = stateCodeOf(gstin);
    const h = heads(gst, !!st && !!home && st !== home);
    rows.push({ kind, id, code, date: date.toISOString(), party: String(s?.name ?? fallbackName ?? ""), gstin, invoiceNo, taxable: r2(sign * taxable), iamt: r2(sign * h.iamt), camt: r2(sign * h.camt), samt: r2(sign * h.samt), total: r2(sign * total), eligible: !!gstin, href });
  };
  for (const x of purchases) push("Pharmacy purchase", String(x._id), String(x.code), x.invoiceDate as Date, x.supplier, String(x.supplierName ?? ""), String(x.supplierInvoiceNo ?? ""), Number(x.taxableTotal ?? 0), Number(x.gstTotal ?? 0), Number(x.netAmount ?? 0), 1, `/pharmacy/purchases/${x._id}`);
  for (const d of docs) {
    const isReturn = d.type === "purchase_return";
    push(isReturn ? "Purchase return" : "Goods receipt", String(d._id), String(d.code), ((isReturn ? d.docDate : d.invoiceDate ?? d.docDate) as Date), d.supplier ?? against.get(String(d.against)), String(d.supplierName ?? ""), String((isReturn ? d.againstCode : d.invoiceNo) ?? ""), Number(d.taxableTotal ?? 0), Number(d.gstTotal ?? 0), Number(d.netAmount ?? 0), isReturn ? -1 : 1, `/inventory/docs/${d._id}`);
  }
  const manual = await manualGst(p);
  for (const m of manual.purchases) {
    rows.push({ kind: "Accounts voucher", id: m.id, code: m.code, date: m.date.toISOString(), party: m.party, gstin: m.gstin, invoiceNo: m.refNo, taxable: m.taxable, iamt: m.iamt, camt: m.camt, samt: m.samt, total: r2(m.taxable + m.iamt + m.camt + m.samt), eligible: !!m.gstin, href: `/accounts/vouchers/${m.id}` });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.code.localeCompare(b.code));
  return { rows, manual };
}

export async function itcRegister(url: URL) {
  const { p, home } = await context(url);
  const { rows } = await inward(p, home);
  const tot = (xs: typeof rows) => ({ taxable: r2(xs.reduce((s, r) => s + r.taxable, 0)), iamt: r2(xs.reduce((s, r) => s + r.iamt, 0)), camt: r2(xs.reduce((s, r) => s + r.camt, 0)), samt: r2(xs.reduce((s, r) => s + r.samt, 0)), total: r2(xs.reduce((s, r) => s + r.total, 0)) });
  return { period: p.label, rows, eligible: tot(rows.filter((r) => r.eligible)), ineligible: tot(rows.filter((r) => !r.eligible)) };
}

export async function gstr3b(url: URL) {
  const { p, home } = await context(url);
  const [{ invoices }, { rows, manual }] = await Promise.all([outward(p, home), inward(p, home)]);

  const out = { taxable: 0, iamt: 0, camt: 0, samt: 0 };
  let nilExempt = 0;
  const interB2c = new Map<string, { pos: string; taxable: number; iamt: number }>();
  for (const inv of invoices) {
    for (const it of inv.items) {
      if (it.zero || it.rate === 0) {
        nilExempt = r2(nilExempt + it.taxable);
        continue;
      }
      const h = heads(it.tax, inv.inter);
      out.taxable = r2(out.taxable + it.taxable);
      out.iamt = r2(out.iamt + h.iamt);
      out.camt = r2(out.camt + h.camt);
      out.samt = r2(out.samt + h.samt);
      if (inv.inter && !inv.ctin) {
        const x = interB2c.get(inv.pos) ?? { pos: inv.pos, taxable: 0, iamt: 0 };
        x.taxable = r2(x.taxable + it.taxable);
        x.iamt = r2(x.iamt + h.iamt);
        interB2c.set(inv.pos, x);
      }
    }
  }
  const outward31a = { taxable: r2(out.taxable + manual.out.taxable), iamt: r2(out.iamt + manual.out.iamt), camt: r2(out.camt + manual.out.camt), samt: r2(out.samt + manual.out.samt) };

  const sumRows = (xs: typeof rows) => ({ iamt: r2(xs.reduce((s, r) => s + r.iamt, 0)), camt: r2(xs.reduce((s, r) => s + r.camt, 0)), samt: r2(xs.reduce((s, r) => s + r.samt, 0)) });
  const itc = sumRows(rows.filter((r) => r.eligible));
  const blocked = sumRows(rows.filter((r) => !r.eligible));
  const inwardExempt = r2(rows.filter((r) => r.iamt === 0 && r.camt === 0 && r.samt === 0).reduce((s, r) => s + r.taxable, 0));

  const payable = { iamt: r2(outward31a.iamt - itc.iamt), camt: r2(outward31a.camt - itc.camt), samt: r2(outward31a.samt - itc.samt) };
  return {
    period: p.label,
    t31a: outward31a,
    t31c: nilExempt,
    t32: [...interB2c.values()].map((x) => ({ ...x, state: GST_STATES[x.pos] ?? x.pos })),
    t4a5: itc,
    t4d2: blocked,
    t5: inwardExempt,
    manual: manual.out,
    payable,
    cashPayable: { iamt: Math.max(0, payable.iamt), camt: Math.max(0, payable.camt), samt: Math.max(0, payable.samt) },
  };
}

export const GST_REPORTS = { gstr1, gstr3b, itc: itcRegister } as const;
