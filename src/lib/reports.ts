import "server-only";
import type { Types } from "mongoose";
import { ApiError, escapeRegex } from "./api";
import { r2 } from "./billing-math";
import { Purchase, Sale } from "@/models/pharmacy";
import { getRecordModel } from "@/models/records";

type Doc = Record<string, unknown> & { _id: Types.ObjectId };

function day(s: string | null, fallback: Date) {
  if (s && /^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(`${s}T00:00:00.000Z`);
  return fallback;
}
function todayUtc() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}
const END = (d: Date) => new Date(d.getTime() + 86400_000 - 1);
const iso = (d: unknown) => (d instanceof Date ? d.toISOString() : null);

/* ---------- Day book ---------- */

export async function dayBook(url: URL) {
  const date = day(url.searchParams.get("date"), todayUtc());
  const range = { $gte: date, $lte: END(date) };
  const Invoices = getRecordModel("billing", "invoices")!;

  const [sales, purchases, invoices] = await Promise.all([
    Sale.find({ billDate: range }).sort({ createdAt: 1 }).select("-items").lean(),
    Purchase.find({ invoiceDate: range }).sort({ createdAt: 1 }).select("-items").lean(),
    Invoices.find({ invoiceDate: range }).sort({ createdAt: 1 }).populate({ path: "patient", select: "fullName code" }).lean<Doc[]>(),
  ]);

  const entries = [
    ...sales.map((s) => ({
      at: iso(s.createdAt), type: "Pharmacy sale", ref: s.code, refId: String(s._id), party: s.customerName,
      mode: s.paymentMode, amount: s.status === "Cancelled" ? 0 : s.netAmount, received: s.status === "Cancelled" ? 0 : (s.paidAmount ?? 0),
      paid: 0, cancelled: s.status === "Cancelled",
    })),
    ...invoices.map((i) => {
      const net = r2(Number(i.amount ?? 0) - Number(i.discount ?? 0));
      const cancelled = i.status === "Cancelled";
      return {
        at: iso(i.createdAt), type: "Hospital invoice", ref: String(i.code), refId: String(i._id),
        party: (i.patient as Doc | null)?.fullName as string ?? "—", mode: (i.paymentMethod as string) ?? "—",
        amount: cancelled ? 0 : net, received: cancelled ? 0 : Number(i.paidAmount ?? 0), paid: 0, cancelled,
      };
    }),
    ...purchases.map((p) => ({
      at: iso(p.createdAt), type: "Purchase", ref: p.code, refId: String(p._id), party: `${p.supplierName} (${p.supplierInvoiceNo})`,
      mode: "—", amount: 0, received: 0, paid: p.status === "Cancelled" ? 0 : p.netAmount, cancelled: p.status === "Cancelled",
    })),
  ].sort((a, b) => String(a.at).localeCompare(String(b.at)));

  const byMode = new Map<string, number>();
  for (const e of entries) if (e.received > 0) byMode.set(e.mode, r2((byMode.get(e.mode) ?? 0) + e.received));

  const live = entries.filter((e) => !e.cancelled);
  return {
    date: date.toISOString().slice(0, 10),
    entries,
    summary: {
      pharmacySales: r2(live.filter((e) => e.type === "Pharmacy sale").reduce((s, e) => s + e.amount, 0)),
      hospitalInvoices: r2(live.filter((e) => e.type === "Hospital invoice").reduce((s, e) => s + e.amount, 0)),
      purchases: r2(live.reduce((s, e) => s + e.paid, 0)),
      received: r2(live.reduce((s, e) => s + e.received, 0)),
      cancelled: entries.filter((e) => e.cancelled).length,
      byMode: [...byMode.entries()].map(([mode, amount]) => ({ mode, amount })),
    },
  };
}

/* ---------- Sales register + GST summary ---------- */

export async function salesRegister(url: URL) {
  const today = todayUtc();
  const from = day(url.searchParams.get("from"), new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)));
  const to = day(url.searchParams.get("to"), today);
  if (from > to) throw new ApiError(422, "From date must be before To date");
  const match = { billDate: { $gte: from, $lte: END(to) } };

  const [bills, gst] = await Promise.all([
    Sale.find(match).sort({ billDate: 1, createdAt: 1 }).lean(),
    Sale.aggregate<{ _id: number; taxable: number; gst: number; amount: number; qty: number }>([
      { $match: { ...match, status: { $ne: "Cancelled" } } },
      { $unwind: "$items" },
      { $group: { _id: "$items.gstRate", taxable: { $sum: "$items.taxable" }, gst: { $sum: "$items.gst" }, amount: { $sum: "$items.amount" }, qty: { $sum: "$items.qty" } } },
      { $sort: { _id: 1 } },
    ]),
  ]);

  const rows = bills.map((b) => ({
    id: String(b._id), code: b.code, billDate: iso(b.billDate), customerName: b.customerName, paymentMode: b.paymentMode,
    lines: b.items.length, taxable: b.taxableTotal ?? 0, gst: b.gstTotal ?? 0, net: b.netAmount, paid: b.paidAmount ?? 0, status: b.status,
  }));
  const live = rows.filter((r) => r.status !== "Cancelled");
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    rows,
    totals: {
      bills: live.length,
      cancelled: rows.length - live.length,
      taxable: r2(live.reduce((s, r) => s + r.taxable, 0)),
      gst: r2(live.reduce((s, r) => s + r.gst, 0)),
      net: r2(live.reduce((s, r) => s + r.net, 0)),
      paid: r2(live.reduce((s, r) => s + r.paid, 0)),
    },
    gstSummary: gst.map((g) => ({ rate: g._id, qty: g.qty, taxable: r2(g.taxable), cgst: r2(g.gst / 2), sgst: r2(g.gst / 2), gst: r2(g.gst), amount: r2(g.amount) })),
  };
}

/* ---------- Stock report ---------- */

export async function stockReport(url: URL) {
  const filter: Record<string, unknown> = {};
  const q = url.searchParams.get("search")?.trim();
  if (q) {
    const rx = new RegExp(escapeRegex(q.slice(0, 60)), "i");
    filter.$or = [{ name: rx }, { sku: rx }, { manufacturer: rx }];
  }
  const category = url.searchParams.get("category");
  if (category) filter.category = category;

  const items = await getRecordModel("inventory", "items")!.find(filter).sort({ name: 1 }).limit(1000).lean<Doc[]>();
  const batches = await getRecordModel("inventory", "batches")!
    .find({ item: { $in: items.map((i) => i._id) }, quantity: { $gt: 0 } })
    .lean<Doc[]>();
  const today = todayUtc();

  let rows = items.map((it) => {
    const own = batches.filter((b) => String(b.item) === String(it._id));
    const qty = Number(it.quantity ?? 0);
    const reorder = Number(it.reorderLevel ?? 0);
    const nearest = own.map((b) => b.expiryDate as Date | undefined).filter((d): d is Date => d instanceof Date).sort((a, b) => a.getTime() - b.getTime())[0];
    return {
      id: String(it._id), name: it.name as string, sku: (it.sku as string) ?? null, category: it.category as string, unit: (it.unit as string) ?? null,
      quantity: qty, reorderLevel: reorder || null, batches: own.length,
      expiredQty: own.filter((b) => b.expiryDate instanceof Date && b.expiryDate < today).reduce((s, b) => s + Number(b.quantity), 0),
      nearestExpiry: iso(nearest),
      costValue: r2(own.reduce((s, b) => s + Number(b.quantity) * Number(b.purchaseRate ?? 0), 0)),
      mrpValue: r2(own.reduce((s, b) => s + Number(b.quantity) * Number(b.mrp ?? it.mrp ?? 0), 0)),
      status: qty <= 0 ? "Out of stock" : reorder && qty <= reorder ? "Low stock" : "In stock",
    };
  });
  const flag = url.searchParams.get("status");
  if (flag === "low") rows = rows.filter((r) => r.status !== "In stock");

  return {
    rows,
    totals: {
      items: rows.length,
      lowOrOut: rows.filter((r) => r.status !== "In stock").length,
      costValue: r2(rows.reduce((s, r) => s + r.costValue, 0)),
      mrpValue: r2(rows.reduce((s, r) => s + r.mrpValue, 0)),
    },
  };
}

/* ---------- Expiry report ---------- */

export async function expiryReport(url: URL) {
  const days = Math.min(730, Math.max(0, Math.floor(Number(url.searchParams.get("days")) || 90)));
  const today = todayUtc();
  const until = new Date(today.getTime() + days * 86400_000);
  const batches = await getRecordModel("inventory", "batches")!
    .find({ quantity: { $gt: 0 }, expiryDate: { $lte: until } })
    .sort({ expiryDate: 1 })
    .populate({ path: "item", select: "name sku category" })
    .populate({ path: "supplier", select: "name" })
    .lean<Doc[]>();

  const rows = batches.map((b) => {
    const exp = b.expiryDate as Date;
    const left = Math.round((exp.getTime() - today.getTime()) / 86400_000);
    const qty = Number(b.quantity);
    return {
      id: String(b._id), item: ((b.item as Doc | null)?.name as string) ?? "(deleted item)", sku: ((b.item as Doc | null)?.sku as string) ?? null,
      batchNo: b.batchNo as string, expiryDate: iso(exp), daysLeft: left, quantity: qty,
      costValue: r2(qty * Number(b.purchaseRate ?? 0)), supplier: ((b.supplier as Doc | null)?.name as string) ?? null,
      status: left < 0 ? "Expired" : left <= 30 ? "Expiring ≤ 30 days" : `Expiring ≤ ${days} days`,
    };
  });
  return {
    days,
    rows,
    totals: {
      expiredBatches: rows.filter((r) => r.daysLeft < 0).length,
      expiringBatches: rows.filter((r) => r.daysLeft >= 0).length,
      valueAtRisk: r2(rows.reduce((s, r) => s + r.costValue, 0)),
    },
  };
}

/* ---------- Outstanding ---------- */

export async function outstanding() {
  const today = todayUtc();
  const [sales, invoices] = await Promise.all([
    Sale.find({ status: { $in: ["Unpaid", "Partially Paid"] } }).sort({ billDate: 1 }).select("-items").lean(),
    getRecordModel("billing", "invoices")!
      .find({ status: { $in: ["Unpaid", "Partially Paid"] } })
      .sort({ invoiceDate: 1 })
      .populate({ path: "patient", select: "fullName code mobile" })
      .lean<Doc[]>(),
  ]);
  const age = (d: unknown) => (d instanceof Date ? Math.max(0, Math.round((today.getTime() - d.getTime()) / 86400_000)) : 0);
  const rows = [
    ...sales.map((s) => ({
      source: "Pharmacy", id: String(s._id), ref: s.code, date: iso(s.billDate), party: s.customerName, phone: s.customerPhone ?? null,
      billed: s.netAmount, paid: s.paidAmount ?? 0, balance: r2(s.netAmount - (s.paidAmount ?? 0)), ageDays: age(s.billDate),
    })),
    ...invoices.map((i) => {
      const net = r2(Number(i.amount ?? 0) - Number(i.discount ?? 0));
      const p = i.patient as Doc | null;
      return {
        source: "Hospital billing", id: String(i._id), ref: String(i.code), date: iso(i.invoiceDate), party: (p?.fullName as string) ?? "—",
        phone: (p?.mobile as string) ?? null, billed: net, paid: Number(i.paidAmount ?? 0), balance: r2(net - Number(i.paidAmount ?? 0)), ageDays: age(i.invoiceDate),
      };
    }),
  ]
    .filter((r) => r.balance > 0)
    .sort((a, b) => b.ageDays - a.ageDays);

  const bucket = (min: number, max: number) => r2(rows.filter((r) => r.ageDays >= min && r.ageDays <= max).reduce((s, r) => s + r.balance, 0));
  return {
    rows,
    totals: {
      count: rows.length,
      balance: r2(rows.reduce((s, r) => s + r.balance, 0)),
      aging: [
        { label: "0–30 days", amount: bucket(0, 30) },
        { label: "31–60 days", amount: bucket(31, 60) },
        { label: "61–90 days", amount: bucket(61, 90) },
        { label: "90+ days", amount: bucket(91, Infinity) },
      ],
    },
  };
}

export const REPORTS = {
  daybook: dayBook,
  "sales-register": salesRegister,
  stock: stockReport,
  expiry: expiryReport,
  outstanding: () => outstanding(),
} as const;
