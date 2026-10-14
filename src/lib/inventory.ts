import "server-only";
import mongoose, { Types } from "mongoose";
import { ApiError, escapeRegex, pagination, parsePaging } from "./api";
import { logActivity } from "./audit";
import { purchaseLine, purchaseTotals, r2 } from "./billing-math";
import { DOC_CONFIG, ISSUE_DEPARTMENTS, PRIORITIES, isDocType, type DocType } from "./inventory-docs";
import type { SessionUser } from "./session";
import { isObjectId } from "./validation";
import { nextCode } from "@/models/Counter";
import { Ledger, StockDoc, type StockDocDoc } from "@/models/inventory";
import { Purchase } from "@/models/pharmacy";
import { getRecordModel } from "@/models/records";

type Doc = Record<string, unknown> & { _id: Types.ObjectId };
type SDoc = mongoose.HydratedDocument<StockDocDoc>;
type Line = SDoc["lines"][number];

const model = (r: string) => getRecordModel("inventory", r)!;
const Items = () => model("items");
const Batches = () => model("batches");
const Stores = () => model("stores");
const Suppliers = () => model("suppliers");
const Payments = () => model("supplier_payments");
const Patients = () => getRecordModel("patients", "patients")!;
const Admissions = () => getRecordModel("opd_ipd", "admissions")!;
const Invoices = () => getRecordModel("billing", "invoices")!;

const MAX_LINES = 150;

/* ======================= helpers ======================= */

export function todayUtc() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function parseDay(v: unknown): Date | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}(-\d{2})?$/.test(v.trim())) return null;
  const s = v.trim();
  // "YYYY-MM" (expiry month) → last day of that month.
  if (s.length === 7) {
    const [y, m] = s.split("-").map(Number);
    return m >= 1 && m <= 12 ? new Date(Date.UTC(y, m, 0)) : null;
  }
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : d;
}

function num(v: unknown, fallback = NaN) {
  if (v === "" || v === null || v === undefined) return fallback;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function text(v: unknown, max: number) {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function fail(errors: Record<string, string>, message = "Please correct the highlighted fields"): never {
  throw new ApiError(422, message, errors);
}

function plain(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (v instanceof Types.ObjectId) return String(v);
  if (Array.isArray(v)) return v.map(plain);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) if (k !== "__v") out[k === "_id" ? "id" : k] = plain(x);
    return out;
  }
  return v;
}

const sameId = (a: unknown, b: unknown) => a != null && b != null && String(a) === String(b);

/** The active store of a type, created on first use (Main Store, Pharmacy). */
export async function ensureStore(storeType: "Main Store" | "Pharmacy") {
  const found = await Stores().findOne({ storeType, status: "Active" }).sort({ createdAt: 1 }).lean<Doc>();
  if (found) return found;
  const created = await Stores().findOneAndUpdate(
    { name: storeType },
    { $setOnInsert: { name: storeType, storeType, status: "Active" } },
    { upsert: true, returnDocument: "after" }
  ).lean<Doc>();
  return created!;
}

async function getStore(id: unknown, label: string, field = "store") {
  if (!isObjectId(String(id ?? ""))) fail({ [field]: `Select the ${label.toLowerCase()}` });
  const s = await Stores().findById(id).lean<Doc>();
  if (!s || s.status !== "Active") fail({ [field]: `${label} not found or inactive` });
  return s;
}

/* ======================= stock movements ======================= */

export interface Move {
  store: Types.ObjectId;
  storeName?: string;
  item: Types.ObjectId;
  itemName: string;
  batch?: Types.ObjectId;
  batchNo: string;
  expiryDate?: Date | null;
  /** Signed, in issue units. */
  qty: number;
  rate?: number;
  mrp?: number;
  gstRate?: number;
  supplier?: Types.ObjectId;
  /** Batch attributes to overwrite when stock comes in (GRN) instead of only on insert. */
  refresh?: boolean;
  txn: string;
  party?: string;
  department?: string;
}

/**
 * Apply movements atomically per batch: outflows never take a batch below
 * zero, already-applied moves are undone if a later one fails, and every
 * move is written to the stock ledger.
 */
export async function applyMoves(moves: Move[], ctx: { docType: string; docId: Types.ObjectId; docCode: string; byName: string; at?: Date }) {
  const done: Move[] = [];
  try {
    for (const m of moves) {
      if (m.qty === 0) continue;
      if (m.qty < 0) {
        const res = await Batches().updateOne({ _id: m.batch, store: m.store, quantity: { $gte: -m.qty } }, { $inc: { quantity: m.qty } });
        if (res.modifiedCount === 0) throw new ApiError(409, `Not enough stock of ${m.itemName} (batch ${m.batchNo}) in ${m.storeName ?? "the store"}. Refresh and try again.`);
      } else {
        const attrs = { expiryDate: m.expiryDate ?? undefined, mrp: m.mrp, purchaseRate: m.rate, gstRate: m.gstRate != null ? String(m.gstRate) : undefined, supplier: m.supplier };
        const defined = Object.fromEntries(Object.entries(attrs).filter(([, v]) => v !== undefined && v !== null));
        const b = m.batch
          ? await Batches().findOneAndUpdate({ _id: m.batch }, { $inc: { quantity: m.qty }, ...(m.refresh ? { $set: defined } : {}) }, { returnDocument: "after" }).lean<Doc>()
          : await Batches().findOneAndUpdate(
              { item: m.item, store: m.store, batchNo: m.batchNo },
              { $inc: { quantity: m.qty }, ...(m.refresh ? { $set: defined } : { $setOnInsert: defined }) },
              { upsert: true, returnDocument: "after" }
            ).lean<Doc>();
        if (!b) throw new ApiError(409, `Batch ${m.batchNo} of ${m.itemName} no longer exists`);
        m.batch = b._id;
      }
      done.push(m);
      await Items().updateOne({ _id: m.item }, { $inc: { quantity: m.qty } });
    }
  } catch (err) {
    for (const m of done.reverse()) {
      await Batches().updateOne({ _id: m.batch }, { $inc: { quantity: -m.qty } });
      await Items().updateOne({ _id: m.item }, { $inc: { quantity: -m.qty } });
    }
    throw err;
  }
  const at = ctx.at ?? new Date();
  if (done.length) {
    await Ledger.insertMany(
      done.map((m) => ({
        at, store: m.store, storeName: m.storeName, item: m.item, itemName: m.itemName, batch: m.batch, batchNo: m.batchNo,
        qty: r2(m.qty), rate: r2(m.rate ?? 0), value: r2(m.qty * (m.rate ?? 0)), txn: m.txn,
        docType: ctx.docType, docId: ctx.docId, docCode: ctx.docCode, party: m.party, department: m.department, byName: ctx.byName,
      }))
    );
  }
  return done;
}

/** Reverse everything a document posted (using its ledger), e.g. on cancellation. */
export async function reverseMoves(docId: Types.ObjectId, ctx: { docType: string; docCode: string; byName: string }) {
  const entries = await Ledger.find({ docId, txn: { $not: /\(cancelled\)$/ } }).lean();
  // Take stock out before putting it back so a failure leaves nothing half-done.
  const moves: Move[] = entries
    .map((e) => ({ store: e.store, storeName: e.storeName ?? undefined, item: e.item, itemName: e.itemName ?? "", batch: e.batch ?? undefined, batchNo: e.batchNo ?? "", qty: -e.qty, rate: e.rate, txn: `${e.txn} (cancelled)` }))
    .sort((a, b) => a.qty - b.qty);
  await applyMoves(moves, { ...ctx, docId });
}

async function storeQty(store: Types.ObjectId, item: Types.ObjectId) {
  const [r] = await Batches().aggregate<{ q: number }>([{ $match: { store, item } }, { $group: { _id: null, q: { $sum: "$quantity" } } }]);
  return r?.q ?? 0;
}

/** Quantity held by active reservations for an item in a store. */
export async function reservedQty(store: Types.ObjectId, item: Types.ObjectId, except?: unknown) {
  const [r] = await StockDoc.aggregate<{ q: number }>([
    { $match: { type: "reservation", status: "Active", store, ...(except ? { _id: { $ne: new Types.ObjectId(String(except)) } } : {}) } },
    { $unwind: "$lines" },
    { $match: { "lines.item": item } },
    { $group: { _id: null, q: { $sum: "$lines.qty" } } },
  ]);
  return r?.q ?? 0;
}

/** Pick batches first-expiry-first-out (or a chosen batch) for an outflow. */
async function allocate(store: Doc, item: Doc, qty: number, batchId: unknown, opts: { allowExpired?: boolean } = {}) {
  const today = todayUtc();
  const name = String(item.name);
  if (batchId) {
    const b = isObjectId(String(batchId)) ? await Batches().findById(batchId).lean<Doc>() : null;
    if (!b || !sameId(b.item, item._id) || !sameId(b.store, store._id)) fail({ lines: `${name}: batch not found in ${store.name}` });
    if (!opts.allowExpired && b.expiryDate instanceof Date && b.expiryDate < today) fail({ lines: `${name} batch ${b.batchNo} has expired — write it off instead` });
    if (Number(b.quantity) < qty) fail({ lines: `${name} batch ${b.batchNo}: only ${b.quantity} in ${store.name}` });
    return [{ batch: b, qty }];
  }
  const batches = await Batches()
    .find({ item: item._id, store: store._id, quantity: { $gt: 0 }, ...(opts.allowExpired ? {} : { $or: [{ expiryDate: null }, { expiryDate: { $exists: false } }, { expiryDate: { $gte: today } }] }) })
    .sort({ expiryDate: 1, createdAt: 1 })
    .lean<Doc[]>();
  const out: { batch: Doc; qty: number }[] = [];
  let left = qty;
  for (const b of batches) {
    if (left <= 0) break;
    const take = Math.min(left, Number(b.quantity));
    out.push({ batch: b, qty: take });
    left = r2(left - take);
  }
  if (left > 0) fail({ lines: `${name}: only ${r2(qty - left)} usable in ${store.name}, ${qty} requested` });
  return out;
}

async function loadItems(ids: unknown[]) {
  const valid = ids.filter((i) => isObjectId(String(i)));
  const items = await Items().find({ _id: { $in: valid } }).populate([{ path: "issueUnit", select: "name symbol" }, { path: "purchaseUnit", select: "name symbol" }]).lean<Doc[]>();
  return new Map(items.map((i) => [String(i._id), i]));
}

const unitName = (u: unknown) => (u && typeof u === "object" ? String((u as Doc).symbol ?? (u as Doc).name ?? "") : "");
const conversionOf = (item: Doc) => (Number(item.conversion) > 0 ? Number(item.conversion) : 1);

function baseLine(item: Doc) {
  return { item: item._id, itemName: String(item.name), sku: (item.sku as string) ?? undefined, unit: unitName(item.issueUnit) || undefined, purchaseUnit: unitName(item.purchaseUnit) || undefined, conversion: conversionOf(item) };
}

function rawLines(body: Record<string, unknown>) {
  const lines = Array.isArray(body.lines) ? (body.lines as Record<string, unknown>[]) : [];
  if (lines.length === 0) fail({ lines: "Add at least one item" });
  if (lines.length > MAX_LINES) fail({ lines: `At most ${MAX_LINES} lines per document` });
  return lines;
}

/* ======================= item search (for line entry & scanning) ======================= */

export async function searchItems(q: string, storeId?: string | null, ids: string[] = []) {
  const store = storeId && isObjectId(storeId) ? new Types.ObjectId(storeId) : null;
  const byId = ids.filter(isObjectId).slice(0, 150);
  const exact = byId.length
    ? await Items().find({ _id: { $in: byId } }).lean<Doc[]>()
    : q ? await Items().find({ status: { $ne: "Inactive" }, $or: [{ barcode: q }, { sku: q.toUpperCase() }] }).limit(5).lean<Doc[]>() : [];
  const rx = q ? new RegExp(escapeRegex(q.slice(0, 60)), "i") : null;
  const items = exact.length || byId.length
    ? exact
    : await Items().find({ status: { $ne: "Inactive" }, ...(rx ? { $or: [{ name: rx }, { sku: rx }, { barcode: rx }, { manufacturer: rx }] } : {}) }).sort({ name: 1 }).limit(15).lean<Doc[]>();
  const full = await loadItems(items.map((i) => i._id));
  const today = todayUtc();
  const batches = store ? await Batches().find({ store, item: { $in: items.map((i) => i._id) }, quantity: { $gt: 0 } }).sort({ expiryDate: 1 }).lean<Doc[]>() : [];
  return Promise.all(
    items.map(async (raw) => {
      const it = full.get(String(raw._id)) ?? raw;
      const own = batches.filter((b) => sameId(b.item, it._id));
      const stock = r2(own.reduce((s, b) => s + Number(b.quantity), 0));
      const reserved = store ? await reservedQty(store, it._id) : 0;
      return {
        id: String(it._id), name: String(it.name), sku: (it.sku as string) ?? "", barcode: (it.barcode as string) ?? "", manufacturer: (it.manufacturer as string) ?? "",
        unit: unitName(it.issueUnit), purchaseUnit: unitName(it.purchaseUnit) || unitName(it.issueUnit), conversion: conversionOf(it),
        gstRate: Number(it.gstRate ?? 0), mrp: it.mrp == null ? null : Number(it.mrp), lastRate: it.unitCost == null ? null : Number(it.unitCost),
        batchTracked: it.batchTracked !== "No", totalStock: Number(it.quantity ?? 0), stock, reserved, available: r2(stock - reserved),
        batches: own.map((b) => ({
          id: String(b._id), batchNo: String(b.batchNo), expiryDate: (b.expiryDate as Date | undefined)?.toISOString() ?? null,
          expired: b.expiryDate instanceof Date && b.expiryDate < today, quantity: Number(b.quantity), mrp: Number(b.mrp ?? it.mrp ?? 0), rate: Number(b.purchaseRate ?? 0),
        })),
      };
    })
  );
}

/* ======================= create documents ======================= */

export async function createDoc(typeRaw: unknown, body: Record<string, unknown>, user: SessionUser, req: Request) {
  if (!isDocType(typeRaw)) throw new ApiError(400, "Unknown document type");
  const type = typeRaw;
  const cfg = DOC_CONFIG[type];
  const errors: Record<string, string> = {};
  const now = new Date();
  const docDate = body.docDate ? parseDay(body.docDate) : todayUtc();
  if (!docDate || docDate > todayUtc()) errors.docDate = "Enter a valid date (not in the future)";

  const doc: Record<string, unknown> = { type, docDate, notes: text(body.notes, 500) || undefined, createdBy: user.id, createdByName: user.name };

  // ----- header -----
  let store: Doc | null = null;
  if (cfg.store) {
    if (body.store || cfg.store.required) store = await getStore(body.store, cfg.store.label);
    if (store) Object.assign(doc, { store: store._id, storeName: store.name });
  }
  let toStore: Doc | null = null;
  if (cfg.toStore) {
    toStore = await getStore(body.toStore, "Destination store", "toStore");
    if (sameId(toStore._id, store?._id)) fail({ toStore: "Choose a different store" });
    Object.assign(doc, { toStore: toStore._id, toStoreName: toStore.name });
  }
  let supplier: Doc | null = null;
  if (cfg.supplier) {
    supplier = isObjectId(String(body.supplier ?? "")) ? await Suppliers().findById(body.supplier).lean<Doc>() : null;
    if (!supplier) errors.supplier = "Select the supplier";
    else if (supplier.status === "Inactive") errors.supplier = "Supplier is inactive";
    else Object.assign(doc, { supplier: supplier._id, supplierName: supplier.name });
  }
  let patient: Doc | null = null;
  if (cfg.patient && (body.patient || type === "patient_issue")) {
    patient = isObjectId(String(body.patient ?? "")) ? await Patients().findById(body.patient).lean<Doc>() : null;
    if (!patient) errors.patient = "Select the patient";
    else Object.assign(doc, { patient: patient._id, patientName: patient.fullName, patientCode: patient.code });
    if (patient && body.admission) {
      const adm = isObjectId(String(body.admission)) ? await Admissions().findById(body.admission).lean<Doc>() : null;
      if (!adm || !sameId(adm.patient, patient._id)) errors.admission = "Admission does not belong to this patient";
      else Object.assign(doc, { admission: adm._id, admissionCode: adm.code });
    }
  }
  if (cfg.department) {
    const dept = text(body.department, 60);
    if (type === "issue" && !(ISSUE_DEPARTMENTS as readonly string[]).includes(dept)) errors.department = "Select the department";
    if (dept) doc.department = dept;
  }
  if (cfg.purpose) {
    doc.purpose = text(body.purpose, 200);
    if (!doc.purpose) errors.purpose = "What is the stock reserved for?";
  }
  if (cfg.reasons) {
    const reason = String(body.reason ?? "");
    if (!cfg.reasons.includes(reason)) errors.reason = "Select a reason";
    doc.reason = reason === "Other" && text(body.reasonNote, 200) ? `Other: ${text(body.reasonNote, 200)}` : reason;
  }
  if (cfg.priority) doc.priority = (PRIORITIES as readonly string[]).includes(String(body.priority)) ? String(body.priority) : "Normal";
  if (cfg.requiredBy && body.requiredBy) doc.requiredBy = parseDay(body.requiredBy) ?? undefined;
  if (cfg.expectedDate && body.expectedDate) doc.expectedDate = parseDay(body.expectedDate) ?? undefined;
  if (type === "po") doc.terms = text(body.terms, 500) || undefined;
  if (cfg.invoice) {
    doc.invoiceNo = text(body.invoiceNo, 40).toUpperCase();
    doc.invoiceDate = parseDay(body.invoiceDate);
    if (!doc.invoiceNo) errors.invoiceNo = "Enter the supplier's invoice number";
    if (!doc.invoiceDate || (doc.invoiceDate as Date) > todayUtc()) errors.invoiceDate = "Enter the invoice date";
  }
  if (Object.keys(errors).length) fail(errors);

  const code = await nextCode(cfg.prefix);
  const docId = new Types.ObjectId();
  const ctx = { docType: type, docId, docCode: code, byName: user.name, at: now };
  let moves: Move[] = [];
  let summary = "";
  let after: (() => Promise<void>) | null = null;

  switch (type) {
    /* ----- requisition & reservation: items + quantities ----- */
    case "requisition":
    case "reservation": {
      const raws = rawLines(body);
      const items = await loadItems(raws.map((l) => l.item));
      const seen = new Set<string>();
      doc.lines = raws.map((l, i) => {
        const it = items.get(String(l.item));
        const qty = num(l.qty);
        if (!it) fail({ [`lines.${i}`]: "Select a valid item" });
        if (seen.has(String(it._id))) fail({ [`lines.${i}`]: `${it.name} is listed twice` });
        seen.add(String(it._id));
        if (!(qty > 0)) fail({ [`lines.${i}`]: `${it.name}: enter a quantity` });
        return { ...baseLine(it), qty: r2(qty), rate: Number(it.unitCost ?? 0) * (type === "requisition" ? conversionOf(it) : 1), remarks: text(l.remarks, 120) || undefined };
      });
      if (type === "reservation") {
        for (const [i, l] of (doc.lines as { item: Types.ObjectId; itemName: string; qty: number; unit?: string }[]).entries()) {
          const free = r2((await storeQty(store!._id, l.item)) - (await reservedQty(store!._id, l.item)));
          if (l.qty > free) fail({ [`lines.${i}`]: `${l.itemName}: only ${free} ${l.unit ?? ""} free to reserve in ${store!.name}` });
        }
        doc.status = "Active";
        summary = `Reserved ${(doc.lines as unknown[]).length} item(s) in ${store!.name} for ${doc.purpose}${patient ? ` (${patient.fullName})` : ""}`;
      } else {
        doc.status = "Pending Approval";
        doc.netAmount = r2((doc.lines as { qty: number; rate: number }[]).reduce((s, l) => s + l.qty * l.rate, 0));
        summary = `Raised purchase requisition for ${store!.name}${doc.department ? ` / ${doc.department}` : ""} (${(doc.lines as unknown[]).length} items)`;
      }
      break;
    }

    /* ----- purchase order ----- */
    case "po": {
      if (body.requisition) {
        const pr = isObjectId(String(body.requisition)) ? await StockDoc.findById(body.requisition).lean() : null;
        if (!pr || pr.type !== "requisition") fail({ requisition: "Requisition not found" });
        if (pr.status !== "Approved") fail({ requisition: `Requisition ${pr.code} is ${pr.status.toLowerCase()}` });
        Object.assign(doc, { requisition: pr._id, requisitionCode: pr.code });
      }
      const raws = rawLines(body);
      const items = await loadItems(raws.map((l) => l.item));
      const seen = new Set<string>();
      doc.lines = raws.map((l, i) => {
        const it = items.get(String(l.item));
        if (!it) fail({ [`lines.${i}`]: "Select a valid item" });
        if (seen.has(String(it._id))) fail({ [`lines.${i}`]: `${it.name} is listed twice` });
        seen.add(String(it._id));
        const qty = num(l.qty);
        const rate = num(l.rate);
        const discountPct = num(l.discountPct, 0);
        const gstRate = num(l.gstRate, Number(it.gstRate ?? 0));
        if (!(qty > 0)) fail({ [`lines.${i}`]: `${it.name}: enter the quantity` });
        if (!(rate >= 0)) fail({ [`lines.${i}`]: `${it.name}: enter the rate` });
        if (!(discountPct >= 0 && discountPct <= 100)) fail({ [`lines.${i}`]: `${it.name}: discount must be 0–100%` });
        return { ...baseLine(it), qty: r2(qty), rate: r2(rate), discountPct, gstRate, ...purchaseLine({ qty, purchaseRate: rate, discountPct, gstRate }), remarks: text(l.remarks, 120) || undefined };
      });
      Object.assign(doc, purchaseTotals(doc.lines as ReturnType<typeof purchaseLine>[]));
      doc.status = "Pending Approval";
      summary = `Raised purchase order to ${supplier!.name} — ₹${doc.netAmount}`;
      if (doc.requisition) after = async () => void (await StockDoc.updateOne({ _id: doc.requisition, status: "Approved" }, { $set: { status: "Ordered" } }));
      break;
    }

    /* ----- goods receipt & stock entry: stock in ----- */
    case "grn":
    case "opening": {
      let po: SDoc | null = null;
      if (type === "grn" && body.po) {
        po = isObjectId(String(body.po)) ? ((await StockDoc.findById(body.po)) as unknown as SDoc) : null;
        if (!po || po.type !== "po") fail({ po: "Purchase order not found" });
        if (!["Approved", "Partially Received"].includes(po.status)) fail({ po: `PO ${po.code} is ${po.status.toLowerCase()}` });
        if (!sameId(po.supplier, supplier!._id)) fail({ po: `PO ${po.code} is for ${po.supplierName}` });
        Object.assign(doc, { po: po._id, poCode: po.code });
      }
      if (type === "grn") {
        const invoiceNo = String(doc.invoiceNo);
        const dupGrn = await StockDoc.exists({ type: "grn", supplier: supplier!._id, invoiceNo, status: { $ne: "Cancelled" } });
        const dupPh = await Purchase.exists({ supplier: supplier!._id, supplierInvoiceNo: invoiceNo, status: { $ne: "Cancelled" } });
        if (dupGrn || dupPh) fail({ invoiceNo: `Invoice ${doc.invoiceNo} from ${supplier!.name} is already entered` });
        doc.dueDate = new Date((doc.invoiceDate as Date).getTime() + Number(supplier!.paymentTermsDays ?? 30) * 86400_000);
      }
      const raws = rawLines(body);
      const items = await loadItems(raws.map((l) => l.item));
      const today = todayUtc();
      const perItem = new Map<string, number>();
      doc.lines = raws.map((l, i) => {
        const it = items.get(String(l.item));
        const key = `lines.${i}`;
        if (!it) fail({ [key]: "Select a valid item" });
        const tracked = it.batchTracked !== "No";
        const batchNo = tracked ? text(l.batchNo, 40).toUpperCase() : "NA";
        const expiryDate = l.expiryDate ? parseDay(l.expiryDate) : null;
        const qty = num(l.qty);
        const freeQty = num(l.freeQty, 0);
        const rate = num(l.rate, 0);
        const mrp = num(l.mrp, Number(it.mrp ?? 0));
        const discountPct = num(l.discountPct, 0);
        const gstRate = num(l.gstRate, Number(it.gstRate ?? 0));
        const name = String(it.name);
        if (tracked && !batchNo) fail({ [key]: `${name}: enter the batch number` });
        if (tracked && !expiryDate) fail({ [key]: `${name}: enter the expiry (month/year)` });
        if (expiryDate && expiryDate < today) fail({ [key]: `${name}: batch ${batchNo} is already expired` });
        if (!(qty > 0)) fail({ [key]: `${name}: enter the quantity` });
        if (!(freeQty >= 0)) fail({ [key]: `${name}: free quantity cannot be negative` });
        if (!(rate >= 0)) fail({ [key]: `${name}: enter the rate` });
        if (!(discountPct >= 0 && discountPct <= 100)) fail({ [key]: `${name}: discount must be 0–100%` });
        perItem.set(String(it._id), (perItem.get(String(it._id)) ?? 0) + qty);
        const amounts = type === "grn" ? purchaseLine({ qty, purchaseRate: rate, discountPct, gstRate }) : { taxable: r2(qty * rate), gst: 0, amount: r2(qty * rate) };
        // Opening stock is entered in issue units; GRNs in purchase units.
        const conversion = type === "grn" ? conversionOf(it) : 1;
        return { ...baseLine(it), conversion, batchNo, expiryDate: expiryDate ?? undefined, qty: r2(qty), freeQty: r2(freeQty), rate: r2(rate), mrp: r2(mrp), discountPct, gstRate, ...amounts };
      });
      if (po) {
        for (const [itemId, qty] of perItem) {
          const pl = po.lines.find((l) => sameId(l.item, itemId));
          if (!pl) fail({ lines: `${items.get(itemId)?.name} is not on PO ${po.code}` });
          const pending = r2(pl.qty - (pl.receivedQty ?? 0));
          if (qty > pending) fail({ lines: `${pl.itemName}: only ${pending} ${pl.purchaseUnit ?? ""} pending on PO ${po.code}` });
        }
      }
      if (type === "grn") Object.assign(doc, purchaseTotals(doc.lines as ReturnType<typeof purchaseLine>[]));
      else doc.costValue = r2((doc.lines as { amount: number }[]).reduce((s, l) => s + l.amount, 0));
      moves = (doc.lines as (Line & { conversion: number })[]).map((l) => {
        const units = r2((l.qty + (l.freeQty ?? 0)) * l.conversion);
        // Landed cost per issue unit (excl. GST), spread over free goods too.
        const unitCost = units > 0 ? r2((l.taxable ?? l.qty * l.rate) / units) : 0;
        return {
          store: store!._id, storeName: String(store!.name), item: l.item, itemName: l.itemName, batchNo: l.batchNo ?? "NA", expiryDate: l.expiryDate,
          qty: units, rate: unitCost, mrp: l.mrp ?? undefined, gstRate: l.gstRate, supplier: supplier?._id, refresh: true,
          txn: type === "grn" ? "Goods receipt" : `Stock entry: ${doc.reason}`, party: supplier ? String(supplier.name) : undefined,
        };
      });
      doc.status = "Posted";
      summary = type === "grn"
        ? `GRN from ${supplier!.name} invoice ${doc.invoiceNo} — ₹${doc.netAmount}, ${moves.length} line(s) into ${store!.name}${po ? ` against ${po.code}` : ""}`
        : `Stock entry (${doc.reason}) into ${store!.name}: ${moves.length} line(s), ₹${doc.costValue}`;
      after = async () => {
        for (const m of moves) await Items().updateOne({ _id: m.item }, { $set: { unitCost: m.rate } });
        if (po) {
          for (const [itemId, qty] of perItem) {
            const pl = po.lines.find((l) => sameId(l.item, itemId))!;
            pl.receivedQty = r2((pl.receivedQty ?? 0) + qty);
          }
          po.status = po.lines.every((l) => (l.receivedQty ?? 0) >= l.qty) ? "Received" : "Partially Received";
          await po.save();
        }
      };
      break;
    }

    /* ----- outflows picked from store stock ----- */
    case "transfer":
    case "issue":
    case "patient_issue": {
      let reservation: SDoc | null = null;
      if (body.reservation) {
        reservation = isObjectId(String(body.reservation)) ? ((await StockDoc.findById(body.reservation)) as unknown as SDoc) : null;
        if (!reservation || reservation.type !== "reservation" || reservation.status !== "Active") fail({ reservation: "Reservation not found or no longer active" });
        if (!sameId(reservation.store, store!._id)) fail({ reservation: `Reservation ${reservation.code} is for ${reservation.storeName}` });
        Object.assign(doc, { reservation: reservation._id, reservationCode: reservation.code });
      }
      const raws = rawLines(body);
      const items = await loadItems(raws.map((l) => l.item));
      const lines: Record<string, unknown>[] = [];
      const outByItem = new Map<string, number>();
      for (const [i, l] of raws.entries()) {
        const it = items.get(String(l.item));
        const qty = num(l.qty);
        if (!it) fail({ [`lines.${i}`]: "Select a valid item" });
        if (!(qty > 0)) fail({ [`lines.${i}`]: `${it.name}: enter the quantity` });
        for (const a of await allocate(store!, it, r2(qty), l.batch)) {
          const b = a.batch;
          const mrp = Number(b.mrp ?? it.mrp ?? 0);
          lines.push({
            ...baseLine(it), conversion: 1, batch: b._id, batchNo: b.batchNo, expiryDate: b.expiryDate, qty: a.qty, rate: Number(b.purchaseRate ?? 0), mrp,
            gstRate: Number(b.gstRate ?? it.gstRate ?? 0), amount: r2(a.qty * (type === "patient_issue" ? mrp : Number(b.purchaseRate ?? 0))), remarks: text(l.remarks, 120) || undefined,
          });
        }
        outByItem.set(String(it._id), (outByItem.get(String(it._id)) ?? 0) + qty);
      }
      for (const [itemId, qty] of outByItem) {
        const it = items.get(itemId)!;
        const held = await reservedQty(store!._id, it._id, reservation?._id);
        const have = await storeQty(store!._id, it._id);
        if (have - qty < held) fail({ lines: `${it.name}: ${held} reserved in ${store!.name}; only ${r2(Math.max(0, have - held))} can be issued` });
      }
      doc.lines = lines;
      doc.costValue = r2(lines.reduce((s, l) => s + Number(l.qty) * Number(l.rate), 0));
      if (type === "patient_issue") doc.netAmount = r2(lines.reduce((s, l) => s + Number(l.amount), 0));
      const party = type === "patient_issue" ? String(patient!.fullName) : type === "issue" ? String(doc.department) : String(toStore!.name);
      moves = lines.flatMap((l) => {
        const base = { item: l.item as Types.ObjectId, itemName: String(l.itemName), batchNo: String(l.batchNo), expiryDate: l.expiryDate as Date | undefined, rate: Number(l.rate), mrp: Number(l.mrp), gstRate: Number(l.gstRate) };
        const out: Move = { ...base, store: store!._id, storeName: String(store!.name), batch: l.batch as Types.ObjectId, qty: -Number(l.qty), party, department: doc.department as string | undefined,
          txn: type === "transfer" ? `Transfer to ${toStore!.name}` : type === "issue" ? `Issue to ${doc.department}` : `Issue to patient` };
        return type === "transfer" ? [out, { ...base, store: toStore!._id, storeName: String(toStore!.name), qty: Number(l.qty), txn: `Transfer from ${store!.name}`, party: String(store!.name) }] : [out];
      });
      doc.status = "Posted";
      summary = type === "transfer" ? `Transferred ${lines.length} line(s) from ${store!.name} to ${toStore!.name} (₹${doc.costValue} at cost)`
        : type === "issue" ? `Issued ${lines.length} line(s) from ${store!.name} to ${doc.department} (₹${doc.costValue} at cost)`
        : `Issued ${lines.length} line(s) from ${store!.name} to patient ${patient!.fullName} (₹${doc.netAmount} at MRP)`;
      const chargeToPatient = type === "patient_issue" && body.chargeToPatient !== false && Number(doc.netAmount) > 0;
      doc.chargeToPatient = chargeToPatient;
      after = async () => {
        if (reservation) {
          reservation.status = "Consumed";
          await reservation.save();
        }
        if (chargeToPatient) {
          const inv = await Invoices().create({
            code: await nextCode("INV"), patient: patient!._id, invoiceDate: todayUtc(), amount: doc.netAmount, discount: 0, paidAmount: 0, status: "Unpaid",
            description: `Medicines & consumables issued (${code}): ${lines.map((l) => `${l.itemName} × ${l.qty}`).join(", ")}`.slice(0, 1000),
            createdBy: user.id, updatedBy: user.id,
          });
          await StockDoc.updateOne({ _id: docId }, { $set: { billingInvoice: inv._id, billingInvoiceCode: inv.code } });
        }
      };
      break;
    }

    /* ----- returns against another document ----- */
    case "return":
    case "purchase_return": {
      const src = isObjectId(String(body.against ?? "")) ? ((await StockDoc.findById(body.against)) as unknown as SDoc) : null;
      if (!src || !cfg.against!.includes(src.type as DocType)) fail({ against: `Select the ${cfg.against!.map((t) => DOC_CONFIG[t].singular.toLowerCase()).join(" / ")} to return against` });
      if (src.status !== "Posted") fail({ against: `${src.code} is ${src.status.toLowerCase()}` });
      Object.assign(doc, { against: src._id, againstCode: src.code, againstType: src.type, supplier: src.supplier, supplierName: src.supplierName, patient: src.patient, patientName: src.patientName, patientCode: src.patientCode, department: src.department });
      const back = src.type === "transfer" ? { from: src.toStore!, fromName: src.toStoreName!, to: src.store!, toName: src.storeName! } : { from: src.store!, fromName: src.storeName!, to: src.store!, toName: src.storeName! };
      Object.assign(doc, { store: back.to, storeName: back.toName, toStore: src.type === "transfer" ? back.from : undefined, toStoreName: src.type === "transfer" ? back.fromName : undefined });
      const raws = rawLines(body);
      const lines: Record<string, unknown>[] = [];
      for (const [i, l] of raws.entries()) {
        const sl = src.lines.find((x) => String(x._id) === String(l.line));
        const qty = num(l.qty);
        if (!sl) fail({ [`lines.${i}`]: "Line not found on the source document" });
        if (!(qty > 0)) continue;
        const left = r2(sl.qty - (sl.returnedQty ?? 0));
        if (qty > left) fail({ [`lines.${i}`]: `${sl.itemName}: at most ${left} can be returned` });
        const amounts = type === "purchase_return" ? purchaseLine({ qty, purchaseRate: sl.rate, discountPct: sl.discountPct ?? 0, gstRate: sl.gstRate ?? 0 }) : { amount: r2(qty * (src.type === "patient_issue" ? (sl.mrp ?? 0) : sl.rate)) };
        lines.push({
          item: sl.item, itemName: sl.itemName, sku: sl.sku, unit: sl.unit, purchaseUnit: sl.purchaseUnit, conversion: sl.conversion ?? 1, batch: sl.batch, batchNo: sl.batchNo, expiryDate: sl.expiryDate,
          qty, rate: sl.rate, mrp: sl.mrp, discountPct: sl.discountPct, gstRate: sl.gstRate, sourceLine: sl._id, ...amounts,
        });
      }
      if (lines.length === 0) fail({ lines: "Enter a quantity to return" });
      doc.lines = lines;
      if (type === "purchase_return") Object.assign(doc, purchaseTotals(lines as ReturnType<typeof purchaseLine>[]));
      else doc.netAmount = r2(lines.reduce((s, l) => s + Number(l.amount), 0));
      const fromStore = type === "purchase_return" ? await Stores().findById(src.store).lean<Doc>() : null;
      moves = [];
      for (const l of lines) {
        const units = r2(Number(l.qty) * Number(l.conversion ?? 1));
        const costPerUnit = type === "purchase_return" ? r2(Number(l.taxable) / units) : Number(l.rate);
        const base = { item: l.item as Types.ObjectId, itemName: String(l.itemName), batchNo: String(l.batchNo ?? "NA"), expiryDate: l.expiryDate as Date | undefined, rate: costPerUnit };
        if (type === "purchase_return") {
          const b = await Batches().findOne({ item: l.item, store: src.store, batchNo: l.batchNo }).lean<Doc>();
          if (!b) fail({ lines: `${l.itemName} batch ${l.batchNo} is no longer in ${fromStore?.name ?? "the store"}` });
          const held = await reservedQty(src.store!, l.item as Types.ObjectId);
          if ((await storeQty(src.store!, l.item as Types.ObjectId)) - units < held) fail({ lines: `${l.itemName}: stock is reserved; release the reservation first` });
          moves.push({ ...base, store: src.store!, storeName: src.storeName ?? undefined, batch: b._id, qty: -units, txn: `Return to ${src.supplierName}`, party: src.supplierName ?? undefined });
        } else if (src.type === "transfer") {
          const b = await Batches().findOne({ item: l.item, store: back.from, batchNo: l.batchNo }).lean<Doc>();
          if (!b) fail({ lines: `${l.itemName} batch ${l.batchNo} is no longer in ${back.fromName}` });
          moves.push({ ...base, store: back.from, storeName: back.fromName, batch: b._id, qty: -units, txn: `Returned to ${back.toName}` });
          moves.push({ ...base, store: back.to, storeName: back.toName, batch: l.batch as Types.ObjectId, qty: units, txn: `Returned from ${back.fromName}` });
        } else {
          moves.push({ ...base, store: back.to, storeName: back.toName, batch: l.batch as Types.ObjectId, qty: units, txn: src.type === "issue" ? `Returned by ${src.department}` : "Returned by patient", party: src.patientName ?? src.department ?? undefined });
        }
      }
      doc.reason = doc.reason ?? (text(body.reason, 200) || undefined);
      doc.status = "Posted";
      summary = type === "purchase_return" ? `Returned goods of ${src.code} to ${src.supplierName} — debit note ₹${doc.netAmount}` : `Stock returned against ${src.code} (${lines.length} line(s))`;
      after = async () => {
        for (const l of lines) {
          const sl = src.lines.find((x) => sameId(x._id, l.sourceLine))!;
          sl.returnedQty = r2((sl.returnedQty ?? 0) + Number(l.qty));
        }
        await src.save();
        // Unpaid patient bills are reduced by the value returned.
        if (type === "return" && src.type === "patient_issue" && src.billingInvoice) {
          const inv = await Invoices().findById(src.billingInvoice).lean<Doc>();
          if (inv && inv.status === "Unpaid") {
            await Invoices().updateOne({ _id: inv._id }, { $set: { amount: r2(Math.max(0, Number(inv.amount) - Number(doc.netAmount))) } });
          }
        }
      };
      break;
    }

    /* ----- write-off & adjustment: specific batches ----- */
    case "write_off":
    case "adjustment": {
      const raws = rawLines(body);
      const items = await loadItems(raws.map((l) => l.item));
      const lines: Record<string, unknown>[] = [];
      for (const [i, l] of raws.entries()) {
        const it = items.get(String(l.item));
        const key = `lines.${i}`;
        if (!it) fail({ [key]: "Select a valid item" });
        const qty = num(l.qty);
        if (!Number.isFinite(qty) || qty === 0 || (type === "write_off" && qty < 0)) fail({ [key]: `${it.name}: enter the quantity` });
        const b = isObjectId(String(l.batch ?? "")) ? await Batches().findById(l.batch).lean<Doc>() : null;
        if (!b || !sameId(b.item, it._id) || !sameId(b.store, store!._id)) fail({ [key]: `${it.name}: select a batch in ${store!.name}` });
        const out = type === "write_off" ? qty : -qty;
        if (out > Number(b.quantity)) fail({ [key]: `${it.name} batch ${b.batchNo}: only ${b.quantity} in stock` });
        lines.push({ ...baseLine(it), conversion: 1, batch: b._id, batchNo: b.batchNo, expiryDate: b.expiryDate, qty: r2(qty), rate: Number(b.purchaseRate ?? 0), mrp: Number(b.mrp ?? 0), amount: r2(qty * Number(b.purchaseRate ?? 0)), remarks: text(l.remarks, 120) || undefined });
      }
      doc.lines = lines;
      doc.costValue = r2(lines.reduce((s, l) => s + Number(l.amount), 0));
      moves = lines.map((l) => ({
        store: store!._id, storeName: String(store!.name), item: l.item as Types.ObjectId, itemName: String(l.itemName), batch: l.batch as Types.ObjectId, batchNo: String(l.batchNo),
        qty: type === "write_off" ? -Number(l.qty) : Number(l.qty), rate: Number(l.rate), txn: type === "write_off" ? `Write-off: ${doc.reason}` : `Adjustment: ${doc.reason}`,
      }));
      doc.status = "Posted";
      summary = type === "write_off" ? `Wrote off ${lines.length} line(s) from ${store!.name} (${doc.reason}) — ₹${doc.costValue} at cost` : `Adjusted ${lines.length} batch(es) in ${store!.name} (${doc.reason})`;
      break;
    }

    /* ----- physical verification: snapshot a count sheet ----- */
    case "verification": {
      const filter: Record<string, unknown> = { store: store!._id, quantity: { $gt: 0 } };
      const category = isObjectId(String(body.category ?? "")) ? String(body.category) : null;
      let batches = await Batches().find(filter).sort({ item: 1, expiryDate: 1 }).lean<Doc[]>();
      const items = await loadItems([...new Set(batches.map((b) => String(b.item)))]);
      if (category) batches = batches.filter((b) => sameId(items.get(String(b.item))?.category, category));
      if (batches.length === 0) fail({ store: `No stock to count in ${store!.name}` });
      doc.lines = batches
        .map((b) => {
          const it = items.get(String(b.item))!;
          return { ...baseLine(it), conversion: 1, batch: b._id, batchNo: b.batchNo, expiryDate: b.expiryDate, qty: 0, systemQty: Number(b.quantity), rate: Number(b.purchaseRate ?? 0) };
        })
        .sort((a, b) => a.itemName.localeCompare(b.itemName));
      doc.reason = category ? "Category count" : "Full count";
      doc.status = "Counting";
      summary = `Started physical verification of ${store!.name} (${batches.length} batches)`;
      break;
    }
  }

  Object.assign(doc, { _id: docId, code });
  if (moves.length) await applyMoves(moves, ctx);
  let created;
  try {
    created = await StockDoc.create({ ...doc, postedAt: doc.status === "Posted" ? now : undefined, postedByName: doc.status === "Posted" ? user.name : undefined });
  } catch (err) {
    if (moves.length) await reverseMoves(docId, ctx);
    throw err;
  }
  if (after) await after();
  await audit(req, user, type, created, summary, "create");
  return getDoc(String(created._id));
}

function audit(req: Request, user: SessionUser, type: string, d: { _id: unknown; code: string }, summary: string, action: "create" | "update" = "update") {
  return logActivity({ req, user, action, module: "inventory", resource: type, entityId: String(d._id), entityLabel: d.code, summary });
}

/* ======================= document actions ======================= */

export async function docAction(id: string, body: Record<string, unknown>, user: SessionUser, req: Request) {
  if (!isObjectId(id)) throw new ApiError(404, "Document not found");
  const d = (await StockDoc.findById(id)) as unknown as SDoc | null;
  if (!d) throw new ApiError(404, "Document not found");
  const action = String(body.action ?? "");
  const reason = text(body.reason, 300);
  const now = new Date();
  const need = (states: string[], what: string) => {
    if (!states.includes(d.status)) throw new ApiError(409, `${d.code} is ${d.status.toLowerCase()} — cannot ${what}`);
  };
  const needReason = () => {
    if (reason.length < 3) fail({ reason: "Enter a reason" });
  };
  let summary = "";

  if (action === "approve") {
    if (d.type !== "requisition" && d.type !== "po") throw new ApiError(400, "Nothing to approve");
    need(["Pending Approval"], "approve");
    if (sameId(d.createdBy, user.id) && d.type === "po" && user.role !== "super_admin") throw new ApiError(403, "A purchase order must be approved by someone other than the person who raised it.");
    d.status = "Approved";
    d.approvedAt = now;
    d.approvedByName = user.name;
    summary = `Approved ${d.code}`;
  } else if (action === "reject") {
    need(["Pending Approval"], "reject");
    needReason();
    d.status = d.type === "po" ? "Cancelled" : "Rejected";
    d.cancelReason = reason;
    d.cancelledAt = now;
    d.cancelledByName = user.name;
    summary = `Rejected ${d.code}: ${reason}`;
  } else if (action === "close") {
    if (d.type === "requisition") need(["Approved", "Ordered"], "close");
    else if (d.type === "po") need(["Approved", "Partially Received"], "close");
    else throw new ApiError(400, "Only requisitions and purchase orders can be closed");
    d.status = "Closed";
    d.cancelReason = reason || undefined;
    summary = `Closed ${d.code}${reason ? `: ${reason}` : ""}`;
  } else if (action === "release") {
    if (d.type !== "reservation") throw new ApiError(400, "Only reservations can be released");
    need(["Active"], "release");
    d.status = "Released";
    d.cancelledAt = now;
    d.cancelledByName = user.name;
    summary = `Released reservation ${d.code}`;
  } else if (action === "count") {
    if (d.type !== "verification") throw new ApiError(400, "Only verifications take counts");
    need(["Counting"], "record counts");
    const counts = new Map((Array.isArray(body.counts) ? (body.counts as Record<string, unknown>[]) : []).map((c) => [String(c.line), c.counted]));
    for (const l of d.lines) {
      if (!counts.has(String(l._id))) continue;
      const v = counts.get(String(l._id));
      const n = num(v);
      if (v === "" || v === null || v === undefined) l.countedQty = undefined;
      else if (!(n >= 0)) fail({ counts: `${l.itemName} batch ${l.batchNo}: enter a valid count` });
      else l.countedQty = r2(n);
    }
    summary = `Saved counts on ${d.code}`;
  } else if (action === "post") {
    if (d.type !== "verification") throw new ApiError(400, "Only verifications are posted this way");
    need(["Counting"], "post");
    const uncounted = d.lines.filter((l) => l.countedQty == null).length;
    if (uncounted && body.confirmUncounted !== true) throw new ApiError(422, `${uncounted} line(s) are not counted yet. Count them, or confirm to treat them as matching the system.`, { counts: "uncounted" });
    const moves: Move[] = [];
    for (const l of d.lines) {
      const diff = l.countedQty == null ? 0 : r2(l.countedQty - (l.systemQty ?? 0));
      l.qty = diff;
      if (diff !== 0) moves.push({ store: d.store!, storeName: d.storeName ?? undefined, item: l.item, itemName: l.itemName, batch: l.batch ?? undefined, batchNo: l.batchNo ?? "NA", qty: diff, rate: l.rate, txn: "Physical verification" });
    }
    await applyMoves(moves, { docType: d.type, docId: d._id, docCode: d.code, byName: user.name, at: now });
    d.costValue = r2(d.lines.reduce((s, l) => s + l.qty * l.rate, 0));
    d.status = "Posted";
    d.postedAt = now;
    d.postedByName = user.name;
    summary = `Posted physical verification ${d.code}: ${moves.length} variance(s), net ₹${d.costValue}`;
  } else if (action === "cancel") {
    needReason();
    if (d.type === "po") {
      need(["Pending Approval", "Approved"], "cancel");
      if (d.lines.some((l) => (l.receivedQty ?? 0) > 0)) throw new ApiError(409, "Goods were already received against this PO. Close it instead.");
    } else if (d.type === "requisition") {
      need(["Pending Approval", "Approved"], "cancel");
    } else if (d.type === "verification") {
      need(["Counting"], "cancel");
    } else if (d.type === "reservation") {
      throw new ApiError(400, "Release the reservation instead");
    } else {
      need(["Posted"], "cancel");
      if (d.lines.some((l) => (l.returnedQty ?? 0) > 0)) throw new ApiError(409, "Items were already returned against this document. Cancel those returns first.");
      if (d.type === "grn") {
        const paid = await Payments().countDocuments({ billRef: d.code });
        if (paid) throw new ApiError(409, "Payments are recorded against this GRN. Delete them before cancelling.");
      }
      let invoice: Doc | null = null;
      if (d.type === "patient_issue" && d.billingInvoice) {
        invoice = await Invoices().findById(d.billingInvoice).lean<Doc>();
        if (invoice && Number(invoice.paidAmount ?? 0) > 0) throw new ApiError(409, `Bill ${invoice.code} already has payments; settle it in Billing first.`);
      }
      await reverseMoves(d._id, { docType: d.type, docCode: d.code, byName: user.name });
      if (d.type === "grn" && d.po) {
        const po = (await StockDoc.findById(d.po)) as unknown as SDoc | null;
        if (po) {
          for (const l of d.lines) {
            const pl = po.lines.find((x) => sameId(x.item, l.item));
            if (pl) pl.receivedQty = r2(Math.max(0, (pl.receivedQty ?? 0) - l.qty));
          }
          if (po.status === "Received" || po.status === "Partially Received") po.status = po.lines.some((l) => (l.receivedQty ?? 0) > 0) ? "Partially Received" : "Approved";
          await po.save();
        }
      }
      if ((d.type === "return" || d.type === "purchase_return") && d.against) {
        const src = (await StockDoc.findById(d.against)) as unknown as SDoc | null;
        if (src) {
          for (const l of d.lines) {
            const sl = src.lines.find((x) => sameId(x._id, l.sourceLine));
            if (sl) sl.returnedQty = r2(Math.max(0, (sl.returnedQty ?? 0) - l.qty));
          }
          await src.save();
        }
      }
      if (invoice && invoice.status !== "Cancelled") await Invoices().updateOne({ _id: invoice._id }, { $set: { status: "Cancelled" } });
    }
    d.status = "Cancelled";
    d.cancelledAt = now;
    d.cancelReason = reason;
    d.cancelledByName = user.name;
    summary = `Cancelled ${d.code}${["po", "requisition", "verification"].includes(d.type) ? "" : " — stock movements reversed"}. Reason: ${reason}`;
  } else {
    throw new ApiError(400, "Unknown action");
  }

  try {
    await d.save();
  } catch (err) {
    if (err instanceof mongoose.Error.VersionError) throw new ApiError(409, "This document was just changed by someone else. Refresh and try again.");
    throw err;
  }
  await audit(req, user, d.type, d, summary);
  return getDoc(id);
}

/* ======================= read documents ======================= */

export async function getDoc(id: string) {
  if (!isObjectId(id)) throw new ApiError(404, "Document not found");
  const d = await StockDoc.findById(id).lean();
  if (!d) throw new ApiError(404, "Document not found");
  const linked = await StockDoc.find({ $or: [{ against: d._id }, { po: d._id }, { requisition: d._id }, { reservation: d._id }] })
    .select("type code docDate status netAmount costValue")
    .sort({ createdAt: 1 })
    .lean();
  const payments = d.type === "grn" ? await Payments().find({ billRef: d.code }).sort({ paymentDate: 1 }).lean<Doc[]>() : [];
  const supplier = d.supplier ? await Suppliers().findById(d.supplier).lean<Doc>() : null;
  return {
    ...(plain(d) as Record<string, unknown>),
    linked: linked.map((l) => plain(l)),
    payments: payments.map((p) => ({ code: p.code, date: (p.paymentDate as Date)?.toISOString(), amount: p.amount, mode: p.mode, reference: p.reference ?? null })),
    supplierInfo: supplier ? { name: supplier.name, phone: supplier.phone, email: supplier.email ?? null, gstin: supplier.gstin ?? null, address: supplier.address ?? null } : null,
    org: { name: process.env.HOSPITAL_NAME || "MediCare Hospital", address: process.env.HOSPITAL_ADDRESS || "", phone: process.env.HOSPITAL_PHONE || "", gstin: process.env.HOSPITAL_GSTIN || "" },
  };
}

export async function listDocs(url: URL) {
  const type = url.searchParams.get("type");
  if (!isDocType(type)) throw new ApiError(400, "Unknown document type");
  const { page, limit, skip } = parsePaging(url, 15);
  const filter: Record<string, unknown> = { type };
  const q = url.searchParams.get("search")?.trim();
  if (q) {
    const rx = new RegExp(escapeRegex(q.slice(0, 60)), "i");
    filter.$or = [{ code: rx }, { supplierName: rx }, { patientName: rx }, { storeName: rx }, { toStoreName: rx }, { department: rx }, { invoiceNo: rx }, { purpose: rx }, { "lines.itemName": rx }];
  }
  const status = url.searchParams.get("status");
  if (status) filter.status = status;
  for (const key of ["store", "supplier", "patient"]) {
    const v = url.searchParams.get(key);
    if (v && isObjectId(v)) filter[key] = new Types.ObjectId(v);
  }
  const from = parseDay(url.searchParams.get("from"));
  const to = parseDay(url.searchParams.get("to"));
  if (from || to) filter.docDate = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
  const [docs, total] = await Promise.all([
    StockDoc.find(filter).sort({ docDate: -1, createdAt: -1 }).skip(skip).limit(limit).lean(),
    StockDoc.countDocuments(filter),
  ]);
  return {
    items: docs.map((d) => ({
      id: String(d._id), code: d.code, docDate: d.docDate.toISOString(), status: d.status, storeName: d.storeName ?? null, toStoreName: d.toStoreName ?? null,
      supplierName: d.supplierName ?? null, patientName: d.patientName ?? null, department: d.department ?? null, purpose: d.purpose ?? null, reason: d.reason ?? null,
      invoiceNo: d.invoiceNo ?? null, againstCode: d.againstCode ?? null, poCode: d.poCode ?? null, netAmount: d.netAmount, costValue: d.costValue,
      lines: d.lines.length, summary: d.lines.slice(0, 3).map((l) => l.itemName).join(", ") + (d.lines.length > 3 ? ` +${d.lines.length - 3}` : ""),
      received: d.type === "po" ? r2(d.lines.reduce((s, l) => s + (l.receivedQty ?? 0), 0)) : null, ordered: d.type === "po" ? r2(d.lines.reduce((s, l) => s + l.qty, 0)) : null,
      createdByName: d.createdByName ?? null,
    })),
    pagination: pagination(page, limit, total),
  };
}

/* ======================= stock views ======================= */

async function categoryNames() {
  const cats = await model("categories").find().select("name").lean<Doc[]>();
  return new Map(cats.map((c) => [String(c._id), String(c.name)]));
}

/** Store-wise (or all-store) stock per item with levels, reservations and expiry. */
export async function stockOverview(url: URL) {
  const storeId = url.searchParams.get("store");
  const store = storeId && isObjectId(storeId) ? new Types.ObjectId(storeId) : null;
  const today = todayUtc();
  const soon = new Date(today.getTime() + 90 * 86400_000);
  const rows = await Batches().aggregate<{ _id: Types.ObjectId; qty: number; value: number; mrpValue: number; nearest: Date | null; expired: number; expiring: number; batches: number; stores: Types.ObjectId[] }>([
    { $match: { quantity: { $gt: 0 }, ...(store ? { store } : {}) } },
    {
      $group: {
        _id: "$item", qty: { $sum: "$quantity" }, value: { $sum: { $multiply: ["$quantity", { $ifNull: ["$purchaseRate", 0] }] } },
        mrpValue: { $sum: { $multiply: ["$quantity", { $ifNull: ["$mrp", 0] }] } }, nearest: { $min: "$expiryDate" },
        expired: { $sum: { $cond: [{ $lt: ["$expiryDate", today] }, "$quantity", 0] } },
        expiring: { $sum: { $cond: [{ $and: [{ $gte: ["$expiryDate", today] }, { $lte: ["$expiryDate", soon] }] }, "$quantity", 0] } },
        batches: { $sum: 1 }, stores: { $addToSet: "$store" },
      },
    },
  ]);
  const byItem = new Map(rows.map((r) => [String(r._id), r]));
  const q = url.searchParams.get("search")?.trim();
  const filter: Record<string, unknown> = {};
  if (q) {
    const rx = new RegExp(escapeRegex(q.slice(0, 60)), "i");
    filter.$or = [{ name: rx }, { sku: rx }, { barcode: q }, { manufacturer: rx }];
  }
  const category = url.searchParams.get("category");
  if (category && isObjectId(category)) filter.category = new Types.ObjectId(category);
  // A store view lists what the store holds; the all-store view lists every active item.
  if (store) filter._id = { $in: rows.map((r) => r._id) };
  else filter.status = { $ne: "Inactive" };
  const items = await Items().find(filter).sort({ name: 1 }).limit(2000).populate({ path: "issueUnit", select: "symbol name" }).lean<Doc[]>();
  const cats = await categoryNames();
  const storeNames = new Map((await Stores().find().select("name").lean<Doc[]>()).map((s) => [String(s._id), String(s.name)]));
  const reservations = await StockDoc.aggregate<{ _id: Types.ObjectId; q: number }>([
    { $match: { type: "reservation", status: "Active", ...(store ? { store } : {}) } },
    { $unwind: "$lines" },
    { $group: { _id: "$lines.item", q: { $sum: "$lines.qty" } } },
  ]);
  const reserved = new Map(reservations.map((r) => [String(r._id), r.q]));
  const flag = url.searchParams.get("flag");

  let out = items.map((it) => {
    const s = byItem.get(String(it._id));
    const qty = r2(s?.qty ?? 0);
    const total = Number(it.quantity ?? 0);
    const min = it.minLevel == null ? null : Number(it.minLevel);
    const max = it.maxLevel == null ? null : Number(it.maxLevel);
    const reorder = it.reorderLevel == null ? null : Number(it.reorderLevel);
    const level = total <= 0 ? "Out of stock" : (reorder != null && total <= reorder) || (min != null && total < min) ? "Reorder" : max != null && total > max ? "Over max" : "OK";
    const res = r2(reserved.get(String(it._id)) ?? 0);
    return {
      id: String(it._id), name: String(it.name), sku: (it.sku as string) ?? "", category: cats.get(String(it.category)) ?? "", unit: unitName(it.issueUnit),
      qty, reserved: res, available: r2(qty - res), totalStock: total, value: r2(s?.value ?? 0), mrpValue: r2(s?.mrpValue ?? 0),
      batches: s?.batches ?? 0, nearestExpiry: s?.nearest ? s.nearest.toISOString() : null, expiredQty: r2(s?.expired ?? 0), expiringQty: r2(s?.expiring ?? 0),
      min, max, reorderLevel: reorder, level, stores: (s?.stores ?? []).map((x) => storeNames.get(String(x)) ?? "").filter(Boolean),
    };
  });
  if (flag === "low") out = out.filter((r) => r.level === "Reorder" || r.level === "Out of stock");
  if (flag === "expiring") out = out.filter((r) => r.expiredQty > 0 || r.expiringQty > 0);
  if (flag === "over") out = out.filter((r) => r.level === "Over max");
  if (flag === "reserved") out = out.filter((r) => r.reserved > 0);
  return {
    rows: out,
    totals: {
      items: out.length,
      value: r2(out.reduce((s, r) => s + r.value, 0)),
      mrpValue: r2(out.reduce((s, r) => s + r.mrpValue, 0)),
      reorder: out.filter((r) => r.level === "Reorder" || r.level === "Out of stock").length,
      expiring: out.filter((r) => r.expiringQty > 0).length,
      expired: out.filter((r) => r.expiredQty > 0).length,
    },
  };
}

/** Items at or below reorder / minimum level, with stock already on order. */
export async function reorderAlerts() {
  const items = await Items()
    .find({ status: { $ne: "Inactive" }, $or: [{ reorderLevel: { $ne: null } }, { minLevel: { $ne: null } }] })
    .populate([{ path: "issueUnit", select: "symbol" }, { path: "purchaseUnit", select: "symbol" }, { path: "supplier", select: "name" }])
    .lean<Doc[]>();
  const onOrder = await StockDoc.aggregate<{ _id: Types.ObjectId; q: number }>([
    { $match: { type: "po", status: { $in: ["Pending Approval", "Approved", "Partially Received"] } } },
    { $unwind: "$lines" },
    { $group: { _id: "$lines.item", q: { $sum: { $subtract: ["$lines.qty", { $ifNull: ["$lines.receivedQty", 0] }] } } } },
  ]);
  const ordered = new Map(onOrder.map((o) => [String(o._id), o.q]));
  const cats = await categoryNames();
  return items
    .map((it) => {
      const qty = Number(it.quantity ?? 0);
      const reorder = it.reorderLevel == null ? null : Number(it.reorderLevel);
      const min = it.minLevel == null ? null : Number(it.minLevel);
      const max = it.maxLevel == null ? null : Number(it.maxLevel);
      const conv = conversionOf(it);
      const due = qty <= 0 || (reorder != null && qty <= reorder) || (min != null && qty < min);
      const target = max ?? (reorder != null ? reorder * 2 : (min ?? 0) * 2);
      const suggested = it.reorderQty != null ? Number(it.reorderQty) : Math.max(1, Math.ceil((target - qty) / conv));
      return {
        id: String(it._id), name: String(it.name), sku: (it.sku as string) ?? "", category: cats.get(String(it.category)) ?? "", unit: unitName(it.issueUnit),
        purchaseUnit: unitName(it.purchaseUnit) || unitName(it.issueUnit), conversion: conv, qty, min, max, reorderLevel: reorder, onOrder: r2(ordered.get(String(it._id)) ?? 0),
        suggested, supplier: (it.supplier as Doc | null)?.name ?? null, supplierId: it.supplier ? String((it.supplier as Doc)._id) : null, due,
        status: qty <= 0 ? "Out of stock" : "Reorder",
      };
    })
    .filter((r) => r.due)
    .sort((a, b) => a.qty - b.qty);
}

/* ======================= supplier bills & dues ======================= */

export async function supplierDues(url: URL) {
  const supplierId = url.searchParams.get("supplier");
  const sFilter = supplierId && isObjectId(supplierId) ? { supplier: new Types.ObjectId(supplierId) } : {};
  const [grns, purchases, returns, payments, suppliers] = await Promise.all([
    StockDoc.find({ type: "grn", status: "Posted", ...sFilter }).select("code supplier supplierName invoiceNo invoiceDate dueDate netAmount").lean(),
    Purchase.find({ status: { $ne: "Cancelled" }, ...sFilter }).select("code supplier supplierName supplierInvoiceNo invoiceDate netAmount").lean(),
    StockDoc.find({ type: "purchase_return", status: "Posted", ...sFilter }).select("againstCode netAmount").lean(),
    Payments().find(sFilter).lean<Doc[]>(),
    Suppliers().find().select("name paymentTermsDays").lean<Doc[]>(),
  ]);
  const terms = new Map(suppliers.map((s) => [String(s._id), Number(s.paymentTermsDays ?? 30)]));
  const returned = new Map<string, number>();
  for (const r of returns) returned.set(String(r.againstCode), r2((returned.get(String(r.againstCode)) ?? 0) + r.netAmount));
  const paid = new Map<string, number>();
  for (const p of payments) if (p.billRef) paid.set(String(p.billRef).toUpperCase(), r2((paid.get(String(p.billRef).toUpperCase()) ?? 0) + Number(p.amount)));
  const today = todayUtc();

  const bills = [
    ...grns.map((g) => ({ id: String(g._id), source: "GRN", code: g.code, supplierId: String(g.supplier), supplier: g.supplierName ?? "", invoiceNo: g.invoiceNo ?? "", invoiceDate: g.invoiceDate ?? null, dueDate: g.dueDate ?? null, amount: g.netAmount })),
    ...purchases.map((p) => ({
      id: String(p._id), source: "Pharmacy purchase", code: p.code, supplierId: String(p.supplier), supplier: p.supplierName ?? "", invoiceNo: p.supplierInvoiceNo, invoiceDate: p.invoiceDate,
      dueDate: new Date(p.invoiceDate.getTime() + (terms.get(String(p.supplier)) ?? 30) * 86400_000), amount: p.netAmount,
    })),
  ].map((b) => {
    const ret = returned.get(b.code) ?? 0;
    const pd = paid.get(b.code.toUpperCase()) ?? 0;
    const balance = r2(b.amount - ret - pd);
    const overdue = balance > 0 && b.dueDate ? Math.max(0, Math.round((today.getTime() - b.dueDate.getTime()) / 86400_000)) : 0;
    return {
      ...b, invoiceDate: b.invoiceDate?.toISOString() ?? null, dueDate: b.dueDate?.toISOString() ?? null, returns: ret, paid: pd, balance, overdueDays: overdue,
      status: balance <= 0 ? "Paid" : overdue > 0 ? "Overdue" : pd > 0 ? "Partially Paid" : "Unpaid",
    };
  });
  const onAccount = new Map<string, number>();
  for (const p of payments) if (!p.billRef) onAccount.set(String(p.supplier), r2((onAccount.get(String(p.supplier)) ?? 0) + Number(p.amount)));
  const bySupplier = new Map<string, { supplierId: string; supplier: string; billed: number; returns: number; paid: number; onAccount: number; outstanding: number; overdue: number }>();
  for (const b of bills) {
    const s = bySupplier.get(b.supplierId) ?? { supplierId: b.supplierId, supplier: b.supplier, billed: 0, returns: 0, paid: 0, onAccount: onAccount.get(b.supplierId) ?? 0, outstanding: 0, overdue: 0 };
    s.billed = r2(s.billed + b.amount);
    s.returns = r2(s.returns + b.returns);
    s.paid = r2(s.paid + b.paid);
    if (b.status === "Overdue") s.overdue = r2(s.overdue + b.balance);
    bySupplier.set(b.supplierId, s);
  }
  for (const s of bySupplier.values()) s.outstanding = r2(s.billed - s.returns - s.paid - s.onAccount);
  const status = url.searchParams.get("status");
  return {
    bills: bills.filter((b) => (status === "open" ? b.balance > 0 : true)).sort((a, b) => b.overdueDays - a.overdueDays || String(a.dueDate).localeCompare(String(b.dueDate))),
    suppliers: [...bySupplier.values()].sort((a, b) => b.outstanding - a.outstanding),
    totals: {
      outstanding: r2([...bySupplier.values()].reduce((s, x) => s + x.outstanding, 0)),
      overdue: r2([...bySupplier.values()].reduce((s, x) => s + x.overdue, 0)),
      bills: bills.filter((b) => b.balance > 0).length,
    },
  };
}

/** Outstanding on one bill (GRN or pharmacy purchase) for payment validation. */
export async function billOutstanding(billRef: string) {
  const code = billRef.trim().toUpperCase();
  const grn = await StockDoc.findOne({ type: "grn", code, status: "Posted" }).select("supplier netAmount code").lean();
  const ph = grn ? null : await Purchase.findOne({ code, status: { $ne: "Cancelled" } }).select("supplier netAmount code").lean();
  const bill = grn ?? ph;
  if (!bill) return null;
  const [ret] = await StockDoc.aggregate<{ s: number }>([{ $match: { type: "purchase_return", status: "Posted", againstCode: code } }, { $group: { _id: null, s: { $sum: "$netAmount" } } }]);
  return { supplier: String(bill.supplier), amount: bill.netAmount, returns: ret?.s ?? 0, code };
}

/* ======================= reports ======================= */

function range(url: URL) {
  const today = todayUtc();
  const from = parseDay(url.searchParams.get("from")) ?? new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const to = parseDay(url.searchParams.get("to")) ?? today;
  if (from > to) throw new ApiError(422, "From date must be before To date");
  return { from, to, end: new Date(to.getTime() + 86400_000 - 1) };
}

export async function inventoryReport(name: string, url: URL) {
  const storeId = url.searchParams.get("store");
  const store = storeId && isObjectId(storeId) ? new Types.ObjectId(storeId) : null;
  const today = todayUtc();

  if (name === "valuation") {
    const rows = await Batches().aggregate<{ _id: Types.ObjectId; qty: number; value: number; mrpValue: number; items: Types.ObjectId[] }>([
      { $match: { quantity: { $gt: 0 } } },
      { $group: { _id: "$store", qty: { $sum: "$quantity" }, value: { $sum: { $multiply: ["$quantity", { $ifNull: ["$purchaseRate", 0] }] } }, mrpValue: { $sum: { $multiply: ["$quantity", { $ifNull: ["$mrp", 0] }] } }, items: { $addToSet: "$item" } } },
    ]);
    const stores = new Map((await Stores().find().lean<Doc[]>()).map((s) => [String(s._id), s]));
    const byCat = await Batches().aggregate<{ _id: Types.ObjectId; value: number; qty: number }>([
      { $match: { quantity: { $gt: 0 }, ...(store ? { store } : {}) } },
      { $lookup: { from: "inventory_items", localField: "item", foreignField: "_id", as: "it" } },
      { $unwind: "$it" },
      { $group: { _id: "$it.category", qty: { $sum: "$quantity" }, value: { $sum: { $multiply: ["$quantity", { $ifNull: ["$purchaseRate", 0] }] } } } },
    ]);
    const cats = await categoryNames();
    return {
      byStore: rows.map((r) => ({ store: String(stores.get(String(r._id))?.name ?? "(no store)"), type: String(stores.get(String(r._id))?.storeType ?? ""), items: r.items.length, qty: r2(r.qty), value: r2(r.value), mrpValue: r2(r.mrpValue) })).sort((a, b) => b.value - a.value),
      byCategory: byCat.map((c) => ({ category: cats.get(String(c._id)) ?? "—", qty: r2(c.qty), value: r2(c.value) })).sort((a, b) => b.value - a.value),
    };
  }

  if (name === "ledger") {
    const itemId = url.searchParams.get("item");
    if (!itemId || !isObjectId(itemId)) throw new ApiError(422, "Select an item");
    const { from, end } = range(url);
    const base = { item: new Types.ObjectId(itemId), ...(store ? { store } : {}) };
    const [opening] = await Ledger.aggregate<{ q: number }>([{ $match: { ...base, at: { $lt: from } } }, { $group: { _id: null, q: { $sum: "$qty" } } }]);
    const entries = await Ledger.find({ ...base, at: { $gte: from, $lte: end } }).sort({ at: 1, _id: 1 }).limit(5000).lean();
    let bal = r2(opening?.q ?? 0);
    const rows = entries.map((e) => {
      bal = r2(bal + e.qty);
      return { at: e.at.toISOString(), store: e.storeName, txn: e.txn, docType: e.docType, docId: e.docId ? String(e.docId) : null, docCode: e.docCode, batchNo: e.batchNo, in: e.qty > 0 ? e.qty : 0, out: e.qty < 0 ? -e.qty : 0, balance: bal, party: e.party ?? e.department ?? null, byName: e.byName };
    });
    return { opening: r2(opening?.q ?? 0), closing: bal, rows };
  }

  if (name === "expiry") {
    const days = Math.min(730, Math.max(0, Math.floor(Number(url.searchParams.get("days")) || 90)));
    const until = new Date(today.getTime() + days * 86400_000);
    const batches = await Batches().find({ quantity: { $gt: 0 }, expiryDate: { $lte: until }, ...(store ? { store } : {}) }).sort({ expiryDate: 1 })
      .populate([{ path: "item", select: "name sku" }, { path: "store", select: "name" }]).lean<Doc[]>();
    return {
      days,
      rows: batches.map((b) => {
        const left = Math.round(((b.expiryDate as Date).getTime() - today.getTime()) / 86400_000);
        return {
          id: String(b._id), itemId: String((b.item as Doc | null)?._id ?? ""), storeId: String((b.store as Doc | null)?._id ?? ""), item: String((b.item as Doc | null)?.name ?? "(deleted)"), sku: (b.item as Doc | null)?.sku ?? null,
          store: String((b.store as Doc | null)?.name ?? "—"), batchNo: b.batchNo, expiryDate: (b.expiryDate as Date).toISOString(), daysLeft: left, qty: Number(b.quantity),
          value: r2(Number(b.quantity) * Number(b.purchaseRate ?? 0)), status: left < 0 ? "Expired" : left <= 30 ? "Expiring ≤ 30 days" : `Expiring ≤ ${days} days`,
        };
      }),
    };
  }

  if (name === "consumption") {
    const { from, end } = range(url);
    const match = { at: { $gte: from, $lte: end }, docType: { $in: ["issue", "patient_issue"] }, ...(store ? { store } : {}) };
    const [byDept, byItem] = await Promise.all([
      Ledger.aggregate<{ _id: { type: string; dept: string | null }; qty: number; value: number; docs: Types.ObjectId[] }>([
        { $match: match },
        { $group: { _id: { type: "$docType", dept: "$department" }, qty: { $sum: { $multiply: ["$qty", -1] } }, value: { $sum: { $multiply: ["$value", -1] } }, docs: { $addToSet: "$docId" } } },
      ]),
      Ledger.aggregate<{ _id: Types.ObjectId; name: string; qty: number; value: number }>([
        { $match: match },
        { $group: { _id: "$item", name: { $first: "$itemName" }, qty: { $sum: { $multiply: ["$qty", -1] } }, value: { $sum: { $multiply: ["$value", -1] } } } },
        { $sort: { value: -1 } },
        { $limit: 50 },
      ]),
    ]);
    return {
      from: from.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10),
      byDepartment: byDept.map((d) => ({ department: d._id.type === "patient_issue" ? "Patients" : (d._id.dept ?? "—"), issues: d.docs.length, qty: r2(d.qty), value: r2(d.value) })).sort((a, b) => b.value - a.value),
      byItem: byItem.map((i) => ({ item: i.name, qty: r2(i.qty), value: r2(i.value) })),
    };
  }

  if (name === "purchases") {
    const { from, to } = range(url);
    const grns = await StockDoc.find({ type: "grn", docDate: { $gte: from, $lte: to } }).sort({ docDate: 1 }).lean();
    const live = grns.filter((g) => g.status !== "Cancelled");
    const bySupplier = new Map<string, { supplier: string; grns: number; taxable: number; gst: number; net: number }>();
    for (const g of live) {
      const s = bySupplier.get(String(g.supplier)) ?? { supplier: g.supplierName ?? "", grns: 0, taxable: 0, gst: 0, net: 0 };
      s.grns++;
      s.taxable = r2(s.taxable + g.taxableTotal);
      s.gst = r2(s.gst + g.gstTotal);
      s.net = r2(s.net + g.netAmount);
      bySupplier.set(String(g.supplier), s);
    }
    return {
      from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10),
      rows: grns.map((g) => ({ id: String(g._id), code: g.code, date: g.docDate.toISOString(), supplier: g.supplierName, invoiceNo: g.invoiceNo, store: g.storeName, lines: g.lines.length, taxable: g.taxableTotal, gst: g.gstTotal, net: g.netAmount, status: g.status, poCode: g.poCode ?? null })),
      bySupplier: [...bySupplier.values()].sort((a, b) => b.net - a.net),
      totals: { grns: live.length, taxable: r2(live.reduce((s, g) => s + g.taxableTotal, 0)), gst: r2(live.reduce((s, g) => s + g.gstTotal, 0)), net: r2(live.reduce((s, g) => s + g.netAmount, 0)) },
    };
  }

  if (name === "non-moving") {
    const days = Math.min(730, Math.max(7, Math.floor(Number(url.searchParams.get("days")) || 90)));
    const since = new Date(Date.now() - days * 86400_000);
    const moved = await Ledger.distinct("item", { qty: { $lt: 0 }, at: { $gte: since }, ...(store ? { store } : {}) });
    const stock = await Batches().aggregate<{ _id: Types.ObjectId; qty: number; value: number }>([
      { $match: { quantity: { $gt: 0 }, item: { $nin: moved }, ...(store ? { store } : {}) } },
      { $group: { _id: "$item", qty: { $sum: "$quantity" }, value: { $sum: { $multiply: ["$quantity", { $ifNull: ["$purchaseRate", 0] }] } } } },
      { $sort: { value: -1 } },
    ]);
    const items = await loadItems(stock.map((s) => s._id));
    const last = await Ledger.aggregate<{ _id: Types.ObjectId; at: Date }>([{ $match: { item: { $in: stock.map((s) => s._id) }, qty: { $lt: 0 } } }, { $group: { _id: "$item", at: { $max: "$at" } } }]);
    const lastOut = new Map(last.map((l) => [String(l._id), l.at]));
    return {
      days,
      rows: stock.map((s) => ({ item: String(items.get(String(s._id))?.name ?? "—"), sku: items.get(String(s._id))?.sku ?? null, qty: r2(s.qty), value: r2(s.value), lastIssue: lastOut.get(String(s._id))?.toISOString() ?? null })),
    };
  }

  throw new ApiError(404, "Unknown report");
}
