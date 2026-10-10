import "server-only";
import { Types } from "mongoose";
import { ApiError, escapeRegex, pagination, parsePaging } from "./api";
import { logActivity } from "./audit";
import { paymentStatus, purchaseLine, purchaseTotals, r2, saleLine, saleTotals } from "./billing-math";
import { GST_RATES, PAYMENT_MODES } from "./modules";
import type { SessionUser } from "./session";
import { isObjectId } from "./validation";
import { nextCode } from "@/models/Counter";
import { Purchase, Sale } from "@/models/pharmacy";
import { getRecordModel } from "@/models/records";

type Doc = Record<string, unknown> & { _id: Types.ObjectId };

const Items = () => getRecordModel("inventory", "items")!;
const Batches = () => getRecordModel("inventory", "batches")!;
const Suppliers = () => getRecordModel("inventory", "suppliers")!;
const Patients = () => getRecordModel("patients", "patients")!;
const Doctors = () => getRecordModel("doctors", "doctors")!;

const PHONE_RE = /^\+?[0-9][0-9\s-]{6,17}$/;
const MAX_LINES = 100;

function todayUtc() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function parseDate(v: unknown): Date | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  // "YYYY-MM" (expiry month, Marg style) -> last day of that month
  if (/^\d{4}-\d{2}$/.test(s)) {
    const [y, m] = s.split("-").map(Number);
    if (m < 1 || m > 12) return null;
    return new Date(Date.UTC(y, m, 0));
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.slice(0, 10))) return null;
  const d = new Date(`${s.slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function num(v: unknown, fallback = NaN) {
  if (v === "" || v === null || v === undefined) return fallback;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function fail(errors: Record<string, string>) {
  throw new ApiError(422, "Please correct the highlighted fields", errors);
}

/** Apply stock movements atomically per batch; undo the ones already applied if any fails. */
async function moveStock(moves: { batch: Types.ObjectId; item: Types.ObjectId; delta: number; label: string }[]) {
  const done: typeof moves = [];
  try {
    for (const m of moves) {
      const guard = m.delta < 0 ? { quantity: { $gte: -m.delta } } : {};
      const res = await Batches().updateOne({ _id: m.batch, ...guard }, { $inc: { quantity: m.delta } });
      if (res.modifiedCount === 0) throw new ApiError(409, `Not enough stock in ${m.label}. Refresh and try again.`);
      done.push(m);
      await Items().updateOne({ _id: m.item }, { $inc: { quantity: m.delta } });
    }
  } catch (err) {
    for (const m of done.reverse()) {
      await Batches().updateOne({ _id: m.batch }, { $inc: { quantity: -m.delta } });
      await Items().updateOne({ _id: m.item }, { $inc: { quantity: -m.delta } });
    }
    throw err;
  }
  return async () => {
    for (const m of [...moves].reverse()) {
      await Batches().updateOne({ _id: m.batch }, { $inc: { quantity: -m.delta } });
      await Items().updateOne({ _id: m.item }, { $inc: { quantity: -m.delta } });
    }
  };
}

export function storeInfo() {
  return {
    name: process.env.HOSPITAL_NAME || "MediCare Hospital Pharmacy",
    address: process.env.HOSPITAL_ADDRESS || "",
    phone: process.env.HOSPITAL_PHONE || "",
    gstin: process.env.HOSPITAL_GSTIN || "",
    drugLicense: process.env.PHARMACY_DL_NO || "",
  };
}

/* ======================= Stock search (POS) ======================= */

export async function searchStock(q: string) {
  const filter: Record<string, unknown> = {};
  if (q) {
    const rx = new RegExp(escapeRegex(q.slice(0, 60)), "i");
    filter.$or = [{ name: rx }, { sku: rx }, { manufacturer: rx }];
  }
  const items = await Items().find(filter).sort({ name: 1 }).limit(12).lean<Doc[]>();
  const batches = await Batches()
    .find({ item: { $in: items.map((i) => i._id) }, quantity: { $gt: 0 } })
    .sort({ expiryDate: 1 })
    .lean<Doc[]>();
  const today = todayUtc();
  return items.map((it) => {
    const own = batches.filter((b) => String(b.item) === String(it._id));
    return {
      id: String(it._id),
      name: it.name as string,
      sku: (it.sku as string) ?? null,
      manufacturer: (it.manufacturer as string) ?? null,
      gstRate: Number(it.gstRate ?? 0),
      mrp: it.mrp == null ? null : Number(it.mrp),
      lastRate: it.unitCost == null ? null : Number(it.unitCost),
      stock: own.reduce((s, b) => s + Number(b.quantity ?? 0), 0),
      batches: own.map((b) => ({
        id: String(b._id),
        batchNo: b.batchNo as string,
        expiryDate: b.expiryDate ? (b.expiryDate as Date).toISOString() : null,
        expired: b.expiryDate instanceof Date && b.expiryDate < today,
        quantity: Number(b.quantity),
        mrp: Number(b.mrp ?? it.mrp ?? 0),
        gstRate: Number(b.gstRate ?? it.gstRate ?? 0),
      })),
    };
  });
}

/* ======================= Sale bills ======================= */

export async function createSale(body: Record<string, unknown>, user: SessionUser, req: Request) {
  const errors: Record<string, string> = {};
  const billDate = body.billDate ? parseDate(body.billDate) : todayUtc();
  if (!billDate) errors.billDate = "Enter a valid bill date";
  else if (billDate.getTime() > todayUtc().getTime()) errors.billDate = "Bill date cannot be in the future";

  const paymentMode = String(body.paymentMode ?? "");
  if (!(PAYMENT_MODES as readonly string[]).includes(paymentMode)) errors.paymentMode = "Select a payment mode";

  let patient: Doc | null = null;
  if (body.patient) {
    if (!isObjectId(body.patient)) errors.patient = "Invalid patient";
    else {
      patient = await Patients().findById(body.patient).lean<Doc>();
      if (!patient) errors.patient = "Patient not found";
    }
  }
  let doctor: Doc | null = null;
  if (body.doctor) {
    if (!isObjectId(body.doctor)) errors.doctor = "Invalid doctor";
    else {
      doctor = await Doctors().findById(body.doctor).lean<Doc>();
      if (!doctor) errors.doctor = "Doctor not found";
    }
  }
  const customerName = (typeof body.customerName === "string" && body.customerName.trim()) || (patient?.fullName as string) || "";
  if (!customerName) errors.customerName = "Enter the customer name or select a patient";
  if (customerName.length > 120) errors.customerName = "Name is too long";
  const customerPhone = (typeof body.customerPhone === "string" && body.customerPhone.trim()) || (patient?.mobile as string) || "";
  if (customerPhone && !PHONE_RE.test(customerPhone)) errors.customerPhone = "Enter a valid phone number";

  const rawLines = Array.isArray(body.items) ? body.items : [];
  if (rawLines.length === 0) errors.items = "Add at least one item";
  if (rawLines.length > MAX_LINES) errors.items = `A bill can have at most ${MAX_LINES} lines`;
  if (Object.keys(errors).length) fail(errors);

  // Resolve batches; MRP and GST always come from stock, never from the client.
  const batchIds = rawLines.map((l) => (l as Record<string, unknown>).batch).filter(isObjectId);
  const batches = await Batches().find({ _id: { $in: batchIds } }).lean<Doc[]>();
  const items = await Items().find({ _id: { $in: batches.map((b) => b.item) } }).lean<Doc[]>();
  const batchMap = new Map(batches.map((b) => [String(b._id), b]));
  const itemMap = new Map(items.map((i) => [String(i._id), i]));
  const today = todayUtc();
  const wanted = new Map<string, number>();

  const lines = rawLines.map((raw, i) => {
    const l = raw as Record<string, unknown>;
    const batch = isObjectId(l.batch) ? batchMap.get(String(l.batch)) : undefined;
    const item = batch ? itemMap.get(String(batch.item)) : undefined;
    const qty = num(l.qty);
    const discountPct = num(l.discountPct, 0);
    const key = `items.${i}`;
    if (!batch || !item) return void (errors[key] = "Select a valid batch");
    if (!Number.isInteger(qty) || qty < 1) return void (errors[key] = `${item.name}: quantity must be a whole number ≥ 1`);
    if (!(discountPct >= 0 && discountPct <= 100)) return void (errors[key] = `${item.name}: discount must be 0–100%`);
    if (batch.expiryDate instanceof Date && batch.expiryDate < today) return void (errors[key] = `${item.name} batch ${batch.batchNo} has expired`);
    wanted.set(String(batch._id), (wanted.get(String(batch._id)) ?? 0) + qty);
    const mrp = Number(batch.mrp ?? item.mrp ?? 0);
    const gstRate = Number(batch.gstRate ?? item.gstRate ?? 0);
    return {
      item: item._id, itemName: String(item.name), hsnCode: (item.hsnCode as string) ?? undefined,
      batch: batch._id, batchNo: String(batch.batchNo), expiryDate: batch.expiryDate as Date | undefined,
      qty, mrp, discountPct, gstRate, ...saleLine({ qty, mrp, discountPct, gstRate }),
    };
  });
  for (const [id, qty] of wanted) {
    const b = batchMap.get(id)!;
    if (Number(b.quantity) < qty) errors.items = `Only ${b.quantity} left in ${itemMap.get(String(b.item))?.name} batch ${b.batchNo}`;
  }
  if (Object.keys(errors).length) fail(errors);

  const okLines = lines as NonNullable<(typeof lines)[number]>[];
  const totals = saleTotals(okLines);
  const paidRaw = num(body.paidAmount, paymentMode === "Credit" ? 0 : totals.netAmount);
  if (!(paidRaw >= 0) || paidRaw > totals.netAmount) fail({ paidAmount: `Paid amount must be between 0 and ${totals.netAmount}` });
  const paidAmount = r2(paidRaw);

  const undo = await moveStock(okLines.map((l) => ({ batch: l.batch, item: l.item, delta: -l.qty, label: `${l.itemName} batch ${l.batchNo}` })));
  try {
    const sale = await Sale.create({
      code: await nextCode("PH"),
      billDate: billDate!, patient: patient?._id, customerName, customerPhone: customerPhone || undefined,
      doctor: doctor?._id, doctorName: (doctor?.fullName as string) ?? undefined,
      paymentMode: paymentMode as (typeof PAYMENT_MODES)[number], items: okLines, ...totals, paidAmount, status: paymentStatus(totals.netAmount, paidAmount),
      notes: typeof body.notes === "string" ? body.notes.trim().slice(0, 500) : undefined,
      createdBy: user.id, createdByName: user.name,
    });
    await logActivity({
      req, user, action: "create", module: "pharmacy", resource: "sales", entityId: String(sale._id), entityLabel: sale.code,
      summary: `Created sale bill ${sale.code} for ${customerName} — ₹${totals.netAmount} (${okLines.length} item${okLines.length === 1 ? "" : "s"}, ${paymentMode})`,
    });
    return sale.toObject();
  } catch (err) {
    await undo();
    throw err;
  }
}

export async function cancelSale(id: string, reason: string, user: SessionUser, req: Request) {
  if (!isObjectId(id)) throw new ApiError(404, "Bill not found");
  if (reason.trim().length < 3) fail({ reason: "Enter a reason for cancelling" });
  // Flip status first so a bill can never be cancelled (and restocked) twice.
  const sale = await Sale.findOneAndUpdate(
    { _id: id, status: { $ne: "Cancelled" } },
    { $set: { status: "Cancelled", cancelledAt: new Date(), cancelReason: reason.trim().slice(0, 300) } },
    { returnDocument: "before" }
  ).lean();
  if (!sale) throw new ApiError(409, "Bill not found or already cancelled");
  for (const l of sale.items) {
    await Batches().updateOne({ _id: l.batch }, { $inc: { quantity: l.qty } });
    await Items().updateOne({ _id: l.item }, { $inc: { quantity: l.qty } });
  }
  await logActivity({
    req, user, action: "update", module: "pharmacy", resource: "sales", entityId: id, entityLabel: sale.code,
    summary: `Cancelled sale bill ${sale.code} (₹${sale.netAmount}) — stock returned. Reason: ${reason.trim()}`,
  });
  return Sale.findById(id).lean();
}

export async function receivePayment(id: string, body: Record<string, unknown>, user: SessionUser, req: Request) {
  if (!isObjectId(id)) throw new ApiError(404, "Bill not found");
  const sale = await Sale.findById(id);
  if (!sale) throw new ApiError(404, "Bill not found");
  if (sale.status === "Cancelled") throw new ApiError(409, "Cancelled bills cannot take payments");
  const amount = num(body.amount);
  const balance = r2(sale.netAmount - (sale.paidAmount ?? 0));
  if (!(amount > 0) || amount > balance) fail({ amount: `Enter an amount between 1 and ${balance}` });
  const mode = String(body.paymentMode ?? sale.paymentMode);
  if (!(PAYMENT_MODES as readonly string[]).includes(mode) || mode === "Credit") fail({ paymentMode: "Select how the payment was received" });
  sale.paidAmount = r2((sale.paidAmount ?? 0) + amount);
  sale.status = paymentStatus(sale.netAmount, sale.paidAmount);
  await sale.save();
  await logActivity({
    req, user, action: "update", module: "pharmacy", resource: "sales", entityId: id, entityLabel: sale.code,
    summary: `Received ₹${amount} (${mode}) against bill ${sale.code}; balance ₹${r2(sale.netAmount - sale.paidAmount)}`,
  });
  return sale.toObject();
}

function dateRange(url: URL, field: string) {
  const range: Record<string, Date> = {};
  const from = parseDate(url.searchParams.get("from") ?? "");
  const to = parseDate(url.searchParams.get("to") ?? "");
  if (from) range.$gte = from;
  if (to) range.$lte = new Date(to.getTime() + 86400_000 - 1);
  return Object.keys(range).length ? { [field]: range } : {};
}

export async function listSales(url: URL) {
  const { page, limit, skip } = parsePaging(url, 15);
  const filter: Record<string, unknown> = { ...dateRange(url, "billDate") };
  const q = url.searchParams.get("search")?.trim();
  if (q) {
    const rx = new RegExp(escapeRegex(q.slice(0, 60)), "i");
    filter.$or = [{ code: rx }, { customerName: rx }, { customerPhone: rx }, { doctorName: rx }];
  }
  const status = url.searchParams.get("status");
  if (status) filter.status = status;
  const patient = url.searchParams.get("patient");
  if (patient && isObjectId(patient)) filter.patient = new Types.ObjectId(patient);

  const [docs, total] = await Promise.all([
    Sale.find(filter).sort({ billDate: -1, createdAt: -1 }).skip(skip).limit(limit).select("-items").lean(),
    Sale.countDocuments(filter),
  ]);
  return { items: docs.map(serializeHeader), pagination: pagination(page, limit, total) };
}

function iso(d: unknown) {
  return d instanceof Date ? d.toISOString() : null;
}

function serializeHeader(d: Record<string, unknown>) {
  const { _id, items, createdBy, __v, ...rest } = d;
  void items; void createdBy; void __v;
  const out: Record<string, unknown> = { id: String(_id) };
  for (const [k, v] of Object.entries(rest)) out[k] = v instanceof Date ? v.toISOString() : v instanceof Types.ObjectId ? String(v) : v;
  return out;
}

export function serializeSale(d: Record<string, unknown>) {
  const items = (d.items as Record<string, unknown>[]).map((l) => ({
    ...l, item: String(l.item), batch: String(l.batch), expiryDate: iso(l.expiryDate),
  }));
  return { ...serializeHeader(d), items };
}

/* ======================= Purchase entries ======================= */

export async function createPurchase(body: Record<string, unknown>, user: SessionUser, req: Request) {
  const errors: Record<string, string> = {};
  let supplier: Doc | null = null;
  if (!isObjectId(body.supplier)) errors.supplier = "Select a supplier";
  else {
    supplier = await Suppliers().findById(body.supplier).lean<Doc>();
    if (!supplier) errors.supplier = "Supplier not found";
  }
  const supplierInvoiceNo = typeof body.supplierInvoiceNo === "string" ? body.supplierInvoiceNo.trim().toUpperCase() : "";
  if (!supplierInvoiceNo) errors.supplierInvoiceNo = "Enter the supplier's invoice number";
  const invoiceDate = parseDate(body.invoiceDate);
  if (!invoiceDate) errors.invoiceDate = "Enter the invoice date";
  else if (invoiceDate.getTime() > todayUtc().getTime()) errors.invoiceDate = "Invoice date cannot be in the future";

  const rawLines = Array.isArray(body.items) ? body.items : [];
  if (rawLines.length === 0) errors.items = "Add at least one item";
  if (rawLines.length > MAX_LINES) errors.items = `An entry can have at most ${MAX_LINES} lines`;
  if (Object.keys(errors).length) fail(errors);

  if (await Purchase.exists({ supplier: supplier!._id, supplierInvoiceNo, status: { $ne: "Cancelled" } })) {
    throw new ApiError(409, `Invoice ${supplierInvoiceNo} from ${supplier!.name} is already entered.`, { supplierInvoiceNo: "Already entered" });
  }

  const itemIds = rawLines.map((l) => (l as Record<string, unknown>).item).filter(isObjectId);
  const items = await Items().find({ _id: { $in: itemIds } }).lean<Doc[]>();
  const itemMap = new Map(items.map((i) => [String(i._id), i]));
  const today = todayUtc();

  const lines = rawLines.map((raw, i) => {
    const l = raw as Record<string, unknown>;
    const key = `items.${i}`;
    const item = isObjectId(l.item) ? itemMap.get(String(l.item)) : undefined;
    if (!item) return void (errors[key] = "Select a valid item");
    const batchNo = typeof l.batchNo === "string" ? l.batchNo.trim().toUpperCase() : "";
    const expiryDate = parseDate(l.expiryDate);
    const qty = num(l.qty);
    const freeQty = num(l.freeQty, 0);
    const purchaseRate = num(l.purchaseRate);
    const mrp = num(l.mrp);
    const discountPct = num(l.discountPct, 0);
    const gstRate = num(l.gstRate, Number(item.gstRate ?? 0));
    const name = String(item.name);
    if (!batchNo || batchNo.length > 40) return void (errors[key] = `${name}: enter the batch number`);
    if (!expiryDate) return void (errors[key] = `${name}: enter the expiry (month/year)`);
    if (expiryDate < today) return void (errors[key] = `${name}: batch ${batchNo} is already expired`);
    if (!Number.isInteger(qty) || qty < 1) return void (errors[key] = `${name}: quantity must be a whole number ≥ 1`);
    if (!Number.isInteger(freeQty) || freeQty < 0) return void (errors[key] = `${name}: free quantity must be a whole number`);
    if (!(purchaseRate >= 0)) return void (errors[key] = `${name}: enter the purchase rate`);
    if (!(mrp > 0)) return void (errors[key] = `${name}: enter the MRP`);
    if (!(discountPct >= 0 && discountPct <= 100)) return void (errors[key] = `${name}: discount must be 0–100%`);
    if (!(GST_RATES as readonly string[]).includes(String(gstRate))) return void (errors[key] = `${name}: GST must be one of ${GST_RATES.join(", ")}%`);
    return { item: item._id, itemName: name, batchNo, expiryDate, qty, freeQty, purchaseRate, mrp, discountPct, gstRate, ...purchaseLine({ qty, purchaseRate, discountPct, gstRate }) };
  });
  if (Object.keys(errors).length) fail(errors);
  const okLines = lines as NonNullable<(typeof lines)[number]>[];

  // Stock in: upsert each batch (item + batch no.) and raise item stock.
  const applied: { batch: Types.ObjectId; item: Types.ObjectId; units: number }[] = [];
  try {
    for (const l of okLines) {
      const units = l.qty + l.freeQty;
      const batch = await Batches().findOneAndUpdate(
        { item: l.item, batchNo: l.batchNo },
        {
          $inc: { quantity: units },
          $set: { expiryDate: l.expiryDate, mrp: l.mrp, purchaseRate: l.purchaseRate, gstRate: String(l.gstRate), supplier: supplier!._id, updatedBy: user.id },
          $setOnInsert: { createdBy: user.id },
        },
        { upsert: true, returnDocument: "after" }
      ).lean<Doc>();
      applied.push({ batch: batch!._id, item: l.item, units });
      (l as typeof l & { batch?: Types.ObjectId }).batch = batch!._id;
      await Items().updateOne({ _id: l.item }, { $inc: { quantity: units }, $set: { unitCost: l.purchaseRate } });
      await Items().updateOne({ _id: l.item, $or: [{ mrp: null }, { mrp: { $exists: false } }] }, { $set: { mrp: l.mrp } });
    }
    const totals = purchaseTotals(okLines);
    const purchase = await Purchase.create({
      code: await nextCode("PUR"),
      supplier: supplier!._id, supplierName: String(supplier!.name), supplierInvoiceNo, invoiceDate: invoiceDate!,
      items: okLines, ...totals, status: "Received",
      notes: typeof body.notes === "string" ? body.notes.trim().slice(0, 500) : undefined,
      createdBy: user.id, createdByName: user.name,
    });
    await logActivity({
      req, user, action: "create", module: "pharmacy", resource: "purchases", entityId: String(purchase._id), entityLabel: purchase.code,
      summary: `Purchase ${purchase.code}: ${supplier!.name} invoice ${supplierInvoiceNo} — ₹${totals.netAmount}, ${okLines.length} item${okLines.length === 1 ? "" : "s"} added to stock`,
    });
    return purchase.toObject();
  } catch (err) {
    for (const a of applied.reverse()) {
      await Batches().updateOne({ _id: a.batch }, { $inc: { quantity: -a.units } });
      await Items().updateOne({ _id: a.item }, { $inc: { quantity: -a.units } });
    }
    throw err;
  }
}

export async function cancelPurchase(id: string, reason: string, user: SessionUser, req: Request) {
  if (!isObjectId(id)) throw new ApiError(404, "Purchase not found");
  if (reason.trim().length < 3) fail({ reason: "Enter a reason for cancelling" });
  const purchase = await Purchase.findById(id).lean();
  if (!purchase || purchase.status === "Cancelled") throw new ApiError(409, "Purchase not found or already cancelled");

  // Stock must still be on hand to reverse the entry.
  await moveStock(
    purchase.items.map((l) => ({ batch: l.batch as Types.ObjectId, item: l.item as Types.ObjectId, delta: -(l.qty + (l.freeQty ?? 0)), label: `${l.itemName} batch ${l.batchNo} (some units already sold)` }))
  );
  await Purchase.updateOne({ _id: id }, { $set: { status: "Cancelled", cancelledAt: new Date(), cancelReason: reason.trim().slice(0, 300) } });
  await logActivity({
    req, user, action: "update", module: "pharmacy", resource: "purchases", entityId: id, entityLabel: purchase.code,
    summary: `Cancelled purchase ${purchase.code} (${purchase.supplierName} ${purchase.supplierInvoiceNo}) — stock reversed. Reason: ${reason.trim()}`,
  });
  return Purchase.findById(id).lean();
}

export async function listPurchases(url: URL) {
  const { page, limit, skip } = parsePaging(url, 15);
  const filter: Record<string, unknown> = { ...dateRange(url, "invoiceDate") };
  const q = url.searchParams.get("search")?.trim();
  if (q) {
    const rx = new RegExp(escapeRegex(q.slice(0, 60)), "i");
    filter.$or = [{ code: rx }, { supplierName: rx }, { supplierInvoiceNo: rx }];
  }
  const status = url.searchParams.get("status");
  if (status) filter.status = status;
  const [docs, total] = await Promise.all([
    Purchase.find(filter).sort({ invoiceDate: -1, createdAt: -1 }).skip(skip).limit(limit).lean(),
    Purchase.countDocuments(filter),
  ]);
  return {
    items: docs.map((d) => ({ ...serializeHeader(d), lines: d.items.length })),
    pagination: pagination(page, limit, total),
  };
}

export function serializePurchase(d: Record<string, unknown>) {
  const items = (d.items as Record<string, unknown>[]).map((l) => ({
    ...l, item: String(l.item), batch: l.batch ? String(l.batch) : null, expiryDate: iso(l.expiryDate),
  }));
  return { ...serializeHeader(d), items };
}
