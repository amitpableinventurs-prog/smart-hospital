import "server-only";
import { Types } from "mongoose";
import {
  GROUP_SEEDS,
  GSTIN_RE,
  GST_STATES,
  LEDGER_SEEDS,
  MONEY_MODES,
  VOUCHER_PREFIX,
  VOUCHER_TYPES,
  financialYear,
  stateCodeOf,
  type Nature,
  type PlSection,
  type VoucherType,
} from "./accounts-shared";
import { ApiError, escapeRegex, pagination, parsePaging } from "./api";
import { logActivity } from "./audit";
import { r2 } from "./billing-math";
import { orgInfo } from "./org";
import type { ResourceRules } from "./rules";
import type { SessionUser } from "./session";
import { isObjectId } from "./validation";
import { AccountsState, Voucher } from "@/models/accounts";
import { Trip } from "@/models/ambulance";
import { Bill } from "@/models/billing";
import { nextSerial } from "@/models/Counter";
import { PayrollRun } from "@/models/hr";
import { Ledger as StockLedger, StockDoc } from "@/models/inventory";
import { LabOrder } from "@/models/laboratory";
import { Purchase, Sale } from "@/models/pharmacy";
import { getRecordModel } from "@/models/records";

/**
 * Double-entry accounts (Marg / Tally style).
 *
 * Masters: account groups and ledgers are generic resources of the "accounts"
 * module; the built-in groups and the ledgers the automatic postings need are
 * created on first use and cannot be deleted.
 *
 * Automatic postings: every money document of the other modules (hospital
 * bills and their receipts, pharmacy sales and purchases, GRNs and purchase
 * returns, lab orders, ambulance trips, vendor and doctor payments, staff
 * advances and paid payroll) is turned into vouchers here. The vouchers of a
 * document are rebuilt from scratch whenever the document changes, so the
 * books always match the modules and nothing in them is edited by hand.
 */

type Doc = Record<string, unknown> & { _id: Types.ObjectId };

const Groups = () => getRecordModel("accounts", "groups")!;
const Ledgers = () => getRecordModel("accounts", "ledgers")!;
const M = (module: string, resource: string) => getRecordModel(module, resource)!;

const DAY = 86400_000;

function fail(errors: Record<string, string>): never {
  throw new ApiError(422, "Please correct the highlighted fields", errors);
}

export function parseDay(v: unknown): Date | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v.trim())) return null;
  const d = new Date(`${v.trim()}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function todayUtc() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** from / to (inclusive) of a report; defaults to the current financial year up to today. */
export function reportRange(url: URL) {
  const today = todayUtc();
  const fyFrom = parseDay(`${financialYear(today).slice(0, 4)}-04-01`)!;
  const from = parseDay(url.searchParams.get("from")) ?? fyFrom;
  const to = parseDay(url.searchParams.get("to")) ?? today;
  if (from > to) throw new ApiError(422, "From date must be before To date");
  return { from, to, end: new Date(to.getTime() + DAY - 1) };
}

/* ======================= masters ======================= */

declare global {
  var __accountsMasters: Promise<void> | undefined;
}

/** Create the built-in groups and ledgers once per process (idempotent). */
export function ensureMasters() {
  globalThis.__accountsMasters ??= seedMasters().catch((err) => {
    globalThis.__accountsMasters = undefined;
    throw err;
  });
  return globalThis.__accountsMasters;
}

async function createOrAdopt(model: ReturnType<typeof Groups>, key: string, doc: Record<string, unknown>) {
  const found = await model.findOne({ systemKey: key }).select("_id name").lean<Doc>();
  if (found) return found;
  try {
    return (await model.create({ ...doc, systemKey: key })).toObject() as Doc;
  } catch (err) {
    // A user record already has this name: adopt it as the built-in one.
    if ((err as { code?: number }).code !== 11000) throw err;
    const same = await model.findOneAndUpdate({ name: doc.name, systemKey: { $in: [null, ""] } }, { $set: { systemKey: key } }, { returnDocument: "after" }).lean<Doc>();
    if (same) return same;
    return (await model.create({ ...doc, name: `${doc.name} (system)`, systemKey: key })).toObject() as Doc;
  }
}

async function seedMasters() {
  const groupIds = new Map<string, { id: Types.ObjectId; name: string }>();
  for (const g of GROUP_SEEDS) {
    const parent = g.parent ? groupIds.get(g.parent) : undefined;
    const doc = await createOrAdopt(Groups(), g.key, { name: g.name, nature: g.nature, parent: parent?.id });
    groupIds.set(g.key, { id: doc._id, name: String(doc.name ?? g.name) });
  }
  for (const l of LEDGER_SEEDS) {
    const group = groupIds.get(l.group)!;
    await createOrAdopt(Ledgers(), l.key, { name: l.name, group: group.id, groupName: group.name, openingBalance: 0, openingType: "Dr", status: "Active" });
  }
}

interface GroupInfo {
  id: string;
  name: string;
  parent: string | null;
  systemKey: string | null;
}

export interface LedgerInfo {
  id: string;
  name: string;
  groupId: string;
  groupName: string;
  /** Built-in primary group the ledger falls under (e.g. "current_assets"). */
  primary: string;
  /** Built-in groups on the way up (e.g. ["cash", "current_assets"]). */
  path: string[];
  nature: Nature;
  pl: PlSection | null;
  /** Opening balance, debit positive. */
  opening: number;
  systemKey: string | null;
  gstin: string | null;
  state: string | null;
  phone: string | null;
  status: string;
}

const SEED_BY_KEY = new Map(GROUP_SEEDS.map((g) => [g.key, g]));

/** Groups and ledgers with their position in the chart of accounts. */
export async function loadChart() {
  await ensureMasters();
  const [groups, ledgers] = await Promise.all([Groups().find().lean<Doc[]>(), Ledgers().find().lean<Doc[]>()]);
  const gmap = new Map<string, GroupInfo>(
    groups.map((g) => [String(g._id), { id: String(g._id), name: String(g.name), parent: g.parent ? String(g.parent) : null, systemKey: (g.systemKey as string) || null }])
  );
  const pathOf = (groupId: string) => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (let g = gmap.get(groupId); g && !seen.has(g.id); g = g.parent ? gmap.get(g.parent) : undefined) {
      seen.add(g.id);
      if (g.systemKey) out.push(g.systemKey);
    }
    return out;
  };
  const lmap = new Map<string, LedgerInfo>();
  for (const l of ledgers) {
    const groupId = String(l.group ?? "");
    const path = pathOf(groupId);
    const primary = path.find((k) => !SEED_BY_KEY.get(k)?.parent) ?? "suspense";
    const seed = SEED_BY_KEY.get(primary)!;
    const amt = Number(l.openingBalance ?? 0);
    lmap.set(String(l._id), {
      id: String(l._id),
      name: String(l.name),
      groupId,
      groupName: gmap.get(groupId)?.name ?? String(l.groupName ?? ""),
      primary,
      path,
      nature: seed.nature,
      pl: seed.pl ?? null,
      opening: r2(l.openingType === "Cr" ? -amt : amt),
      systemKey: (l.systemKey as string) || null,
      gstin: (l.gstin as string) || null,
      state: (l.state as string) || null,
      phone: (l.phone as string) || null,
      status: String(l.status ?? "Active"),
    });
  }
  return { groups: gmap, ledgers: lmap };
}

const isNominal = (l: LedgerInfo) => l.nature === "Income" || l.nature === "Expenses";
const isCashBank = (l: LedgerInfo) => l.path.includes("cash") || l.path.includes("bank") || l.path.includes("bank_od");

/* ---------- rules for the generic masters ---------- */

function reject(field: string, message: string): never {
  throw new ApiError(422, message, { [field]: message });
}

export const ACCOUNTS_RULES: Record<string, ResourceRules> = {
  "accounts.groups": {
    beforeList: ensureMasters,
    beforeSave: async (v, existing) => {
      if (existing?.systemKey) {
        if (v.parent !== undefined && String(v.parent ?? "") !== String(existing.parent ?? "")) reject("parent", "Built-in groups cannot be moved");
        return;
      }
      const parentId = v.parent !== undefined ? v.parent : existing?.parent;
      if (!parentId) reject("parent", "Choose the group this one sits under");
      const parent = await Groups().findById(parentId).lean<Doc>();
      if (!parent) reject("parent", "Group not found");
      if (existing) {
        const all = new Map((await Groups().find().select("parent").lean<Doc[]>()).map((g) => [String(g._id), g.parent ? String(g.parent) : null]));
        for (let g: string | null = String(parent._id); g; g = all.get(g) ?? null) {
          if (g === String(existing._id)) reject("parent", "A group cannot sit under itself or its own sub-group");
        }
      }
      // Nature comes from the built-in group at the top.
      const chart = await loadChart();
      let top = chart.groups.get(String(parent._id));
      while (top?.parent) top = chart.groups.get(top.parent);
      v.nature = SEED_BY_KEY.get(top?.systemKey ?? "")?.nature ?? String(parent.nature ?? "Assets");
    },
    afterSave: async (doc, existing) => {
      if (existing && existing.name !== doc.name) await Ledgers().updateMany({ group: doc._id }, { $set: { groupName: doc.name } });
    },
    beforeDelete: async (d) => {
      if (d.systemKey) throw new ApiError(409, "Built-in groups cannot be deleted.");
      const [groups, ledgers] = await Promise.all([Groups().countDocuments({ parent: d._id }), Ledgers().countDocuments({ group: d._id })]);
      if (groups + ledgers > 0) throw new ApiError(409, `Cannot delete: ${groups} sub-group(s) and ${ledgers} ledger(s) are under this group.`);
    },
  },
  "accounts.ledgers": {
    beforeList: ensureMasters,
    beforeSave: async (v, existing) => {
      if (typeof v.gstin === "string") {
        v.gstin = v.gstin.trim().toUpperCase() || null;
        if (v.gstin && !GSTIN_RE.test(v.gstin)) reject("gstin", "Enter a valid 15-character GSTIN");
      }
      const gstin = (v.gstin !== undefined ? v.gstin : existing?.gstin) as string | null;
      const state = v.state !== undefined ? v.state : existing?.state;
      if (gstin && !state) {
        const code = stateCodeOf(gstin);
        if (code) v.state = `${code} - ${GST_STATES[code]}`;
      }
      if (v.group !== undefined || !existing) {
        if (existing?.systemKey && String(v.group) !== String(existing.group)) reject("group", "Ledgers used by automatic postings cannot change group");
        const group = await Groups().findById(v.group).select("name").lean<Doc>();
        if (!group) reject("group", "Group not found");
        v.groupName = String(group.name);
      }
      const key = existing?.systemKey as string | undefined;
      if (key && !key.includes(":") && v.status === "Inactive") reject("status", "This ledger is used by automatic postings and must stay active");
    },
    beforeDelete: async (d) => {
      if (d.systemKey) throw new ApiError(409, "This ledger is used by automatic postings and cannot be deleted.");
      const n = await Voucher.countDocuments({ "entries.ledger": d._id });
      if (n > 0) throw new ApiError(409, `Cannot delete: ${n} voucher(s) use this ledger. Mark it Inactive instead.`);
      const state = await AccountsState.findById("main").lean();
      if (Object.values((state?.modeLedgers ?? {}) as Record<string, string>).includes(String(d._id))) throw new ApiError(409, "This ledger is set for a payment mode in Accounts Settings.");
    },
  },
};

/* ======================= settings ======================= */

async function loadState() {
  return (await AccountsState.findById("main").lean()) ?? (await AccountsState.create({ _id: "main" })).toObject();
}

/** GST state code of the hospital: from its GSTIN, else the one set in Accounts Settings. */
export async function hospitalState() {
  const fromGstin = stateCodeOf(orgInfo().gstin);
  if (fromGstin) return fromGstin;
  return stateCodeOf((await loadState()).stateCode);
}

export async function getSettings() {
  const chart = await loadChart();
  const state = await loadState();
  const modes = (state.modeLedgers ?? {}) as Record<string, string>;
  const cashBank = [...chart.ledgers.values()].filter(isCashBank).map((l) => ({ id: l.id, name: l.name, group: l.groupName }));
  const [counts] = await Promise.all([Voucher.aggregate<{ _id: { auto: boolean; kind: string | null }; n: number }>([{ $group: { _id: { auto: "$auto", kind: "$sourceKind" }, n: { $sum: 1 } } }])]);
  return {
    modeLedgers: Object.fromEntries(MONEY_MODES.map((m) => [m, modes[m] && chart.ledgers.has(modes[m]) ? modes[m] : defaultModeLedger(chart, m)])),
    cashBank,
    booksFrom: state.booksFrom ? iso(state.booksFrom) : null,
    stateCode: state.stateCode ?? "",
    gstin: orgInfo().gstin || "",
    hospitalState: await hospitalState(),
    lastRunAt: state.lastRunAt ? state.lastRunAt.toISOString() : null,
    lastRunSummary: state.lastRunSummary ?? null,
    vouchers: counts.map((c) => ({ auto: c._id.auto, kind: c._id.kind, count: c.n })),
  };
}

function defaultModeLedger(chart: Awaited<ReturnType<typeof loadChart>>, mode: string) {
  const key = mode === "Cash" ? "cash" : "bank";
  return [...chart.ledgers.values()].find((l) => l.systemKey === key)?.id ?? "";
}

export async function saveSettings(body: Record<string, unknown>, user: SessionUser, req: Request) {
  const chart = await loadChart();
  const errors: Record<string, string> = {};
  const modeLedgers: Record<string, string> = {};
  const raw = (body.modeLedgers ?? {}) as Record<string, unknown>;
  for (const m of MONEY_MODES) {
    const id = String(raw[m] ?? "");
    const l = chart.ledgers.get(id);
    if (!l || !isCashBank(l)) errors[`mode.${m}`] = "Choose a cash or bank ledger";
    else modeLedgers[m] = id;
  }
  let booksFrom: Date | null = null;
  if (body.booksFrom) {
    booksFrom = parseDay(body.booksFrom);
    if (!booksFrom) errors.booksFrom = "Enter a valid date";
  }
  const stateCode = String(body.stateCode ?? "").trim();
  if (stateCode && !stateCodeOf(stateCode)) errors.stateCode = "Choose a state";
  if (Object.keys(errors).length) fail(errors);

  const before = await loadState();
  const changedPosting = JSON.stringify(before.modeLedgers ?? {}) !== JSON.stringify(modeLedgers) || (before.booksFrom ? iso(before.booksFrom) : null) !== (booksFrom ? iso(booksFrom) : null);
  await AccountsState.updateOne({ _id: "main" }, { $set: { modeLedgers, booksFrom, stateCode: stateCodeOf(stateCode) || null, updatedByName: user.name } }, { upsert: true });
  await logActivity({ req, user, action: "update", module: "accounts", resource: "settings", summary: "Updated Accounts settings (payment-mode ledgers, books start, state)" });
  // Mode ledgers and the books start decide every automatic voucher, so rebuild them.
  if (changedPosting) await runPosting({ full: true });
  return getSettings();
}

/* ======================= automatic postings ======================= */

interface Ref {
  id: Types.ObjectId;
  name: string;
}

interface Draft {
  key: string;
  code: string;
  type: VoucherType;
  date: Date;
  narration: string;
  refNo?: string;
  lines: { ledger: Ref; dr: number; cr: number }[];
}

/** Ledger resolution shared by one posting run. */
class Resolver {
  private cache = new Map<string, Ref>();
  constructor(
    private modeLedgers: Record<string, string>,
    private chart: Awaited<ReturnType<typeof loadChart>>
  ) {}

  async system(key: string): Promise<Ref> {
    const hit = this.cache.get(key);
    if (hit) return hit;
    const l = [...this.chart.ledgers.values()].find((x) => x.systemKey === key);
    if (!l) throw new Error(`System ledger ${key} is missing`);
    const ref = { id: new Types.ObjectId(l.id), name: l.name };
    this.cache.set(key, ref);
    return ref;
  }

  async mode(mode: string | null | undefined): Promise<Ref> {
    const id = this.modeLedgers[mode ?? ""];
    const l = id ? this.chart.ledgers.get(id) : undefined;
    if (l) return { id: new Types.ObjectId(l.id), name: l.name };
    return this.system(mode === "Cash" || !mode ? "cash" : "bank");
  }

  /** A ledger created on first use (income heads, parties), found by its system key afterwards. */
  async ensure(key: string, make: () => Promise<{ name: string; group: string; extra?: Record<string, unknown> }>): Promise<Ref> {
    const hit = this.cache.get(key);
    if (hit) return hit;
    let doc = await Ledgers().findOne({ systemKey: key }).select("name").lean<Doc>();
    if (!doc) {
      const spec = await make();
      const group = await Groups().findOne({ systemKey: spec.group }).select("name").lean<Doc>();
      const base = { group: group!._id, groupName: group!.name, openingBalance: 0, openingType: "Dr", status: "Active", systemKey: key, ...spec.extra };
      for (const name of [spec.name, `${spec.name} (${key.split(":")[0]})`, `${spec.name} (${key.slice(-6)})`]) {
        try {
          doc = (await Ledgers().create({ ...base, name: name.slice(0, 120) })).toObject() as Doc;
          break;
        } catch (err) {
          if ((err as { code?: number }).code !== 11000) throw err;
          // Another run may have just created it.
          doc = await Ledgers().findOne({ systemKey: key }).select("name").lean<Doc>();
          if (doc) break;
        }
      }
      if (!doc) throw new Error(`Could not create ledger ${spec.name}`);
    }
    const ref = { id: doc._id, name: String(doc.name) };
    this.cache.set(key, ref);
    return ref;
  }

  income(category: string) {
    return this.ensure(`income:${category}`, async () => ({ name: `${category} Income`, group: "sales" }));
  }

  async party(kind: "supplier" | "corporate" | "insurer", id: unknown, fallback: string): Promise<Ref> {
    if (!id || !isObjectId(String(id))) {
      if (kind !== "supplier") return this.system("payer_receivables");
      return this.ensure("supplier:unknown", async () => ({ name: "Unknown Supplier", group: "creditors" }));
    }
    return this.ensure(`${kind}:${String(id)}`, async () => {
      const src = kind === "supplier" ? M("inventory", "suppliers") : kind === "corporate" ? M("billing", "corporates") : M("insurance", "providers");
      const p = await src.findById(id).lean<Doc>();
      const gstin = typeof p?.gstin === "string" && GSTIN_RE.test(p.gstin.toUpperCase()) ? p.gstin.toUpperCase() : null;
      const code = stateCodeOf(gstin);
      return {
        name: String(p?.name ?? fallback ?? "Party"),
        group: kind === "supplier" ? "creditors" : "debtors",
        extra: { gstin, state: code ? `${code} - ${GST_STATES[code]}` : null, phone: p?.phone ?? null, email: p?.email ?? null, address: p?.address ?? null },
      };
    });
  }
}

/** Tax lines: intra-state supplies split into CGST + SGST, inter-state go to IGST. */
async function gstLines(res: Resolver, side: "dr" | "cr", prefix: "input" | "output", gst: number, inter: boolean) {
  if (!(gst > 0)) return [];
  if (inter) return [{ ledger: await res.system(`${prefix}_igst`), dr: side === "dr" ? gst : 0, cr: side === "cr" ? gst : 0 }];
  const half = r2(gst / 2);
  const rest = r2(gst - half);
  return [
    { ledger: await res.system(`${prefix}_cgst`), dr: side === "dr" ? half : 0, cr: side === "cr" ? half : 0 },
    { ledger: await res.system(`${prefix}_sgst`), dr: side === "dr" ? rest : 0, cr: side === "cr" ? rest : 0 },
  ];
}

/** Merge lines per ledger, push any rounding difference to Round Off and build the voucher. */
async function finalize(res: Resolver, d: Draft, source: { kind: string; id: Types.ObjectId; code: string }) {
  const net = new Map<string, { ledger: Ref; amt: number }>();
  for (const l of d.lines) {
    const k = String(l.ledger.id);
    const cur = net.get(k) ?? { ledger: l.ledger, amt: 0 };
    cur.amt = r2(cur.amt + (l.dr || 0) - (l.cr || 0));
    net.set(k, cur);
  }
  const diff = r2([...net.values()].reduce((s, l) => s + l.amt, 0));
  if (diff !== 0) {
    const ro = await res.system("round_off");
    const cur = net.get(String(ro.id)) ?? { ledger: ro, amt: 0 };
    cur.amt = r2(cur.amt - diff);
    net.set(String(ro.id), cur);
  }
  const entries = [...net.values()].filter((l) => l.amt !== 0).map((l) => ({ ledger: l.ledger.id, ledgerName: l.ledger.name, dr: l.amt > 0 ? l.amt : 0, cr: l.amt < 0 ? -l.amt : 0 }));
  // Debits first, as vouchers are usually read.
  entries.sort((a, b) => b.dr - a.dr);
  const amount = r2(entries.reduce((s, e) => s + e.dr, 0));
  if (entries.length < 2 || amount <= 0) return null;
  return {
    code: d.code, type: d.type, date: d.date, entries, amount, narration: d.narration, refNo: d.refNo,
    auto: true, key: d.key, sourceKind: source.kind, sourceId: source.id, sourceCode: source.code, status: "Active" as const,
  };
}

/** Receipt lines by payment mode. */
async function modeLines(res: Resolver, side: "dr" | "cr", parts: { mode?: string | null; amount: number }[]) {
  const out: Draft["lines"] = [];
  for (const p of parts) if (p.amount > 0) out.push({ ledger: await res.mode(p.mode), dr: side === "dr" ? p.amount : 0, cr: side === "cr" ? p.amount : 0 });
  return out;
}

const sum = <T,>(xs: T[], f: (x: T) => number) => r2(xs.reduce((s, x) => s + (Number(f(x)) || 0), 0));

interface Source {
  kind: string;
  label: string;
  find: (filter: Record<string, unknown>) => Promise<Doc[]>;
  /** Records of this kind can be deleted outright, so orphaned vouchers must be swept. */
  deletable?: boolean;
  exists?: (ids: Types.ObjectId[]) => PromiseLike<unknown[]>;
  build: (doc: Doc, res: Resolver, ctx: { hospitalState: string }) => Promise<Draft[]>;
}

type BillDocLean = Doc & {
  code: string; billDate: Date; status: string; patientName: string; payerType: string; payerName?: string; corporate?: Types.ObjectId; insuranceProvider?: Types.ObjectId;
  patientShare: number; payerShare: number; lines: { status: string; category: string; taxable: number; gst: number }[];
  receipts: { code: string; kind: string; amount: number; writeOff?: number; at: Date; splits: { mode: string; amount: number; recon?: string; reference?: string }[] }[];
};

const SOURCES: Source[] = [
  {
    kind: "bill",
    label: "Hospital bills & receipts",
    find: (f) => Bill.find(f).lean<Doc[]>(),
    async build(raw, res, ctx) {
      const b = raw as BillDocLean;
      const out: Draft[] = [];
      let payer: Ref | null = null;
      let payerGstinState = "";
      if (b.payerType === "Corporate") {
        payer = await res.party("corporate", b.corporate, b.payerName ?? "Corporate");
        const corp = b.corporate ? await M("billing", "corporates").findById(b.corporate).select("gstin").lean<Doc>() : null;
        payerGstinState = stateCodeOf(corp?.gstin);
      } else if (b.payerType === "Insurance") payer = await res.party("insurer", b.insuranceProvider, b.payerName ?? "Insurer");
      if (b.status === "Final" || b.status === "Closed") {
        const live = b.lines.filter((l) => l.status !== "Cancelled");
        const byHead = new Map<string, number>();
        for (const l of live) byHead.set(l.category, r2((byHead.get(l.category) ?? 0) + (l.taxable ?? 0)));
        const lines: Draft["lines"] = [{ ledger: await res.system("patients"), dr: b.patientShare ?? 0, cr: 0 }];
        if (payer && b.payerShare > 0) lines.push({ ledger: payer, dr: b.payerShare, cr: 0 });
        for (const [head, amt] of byHead) lines.push({ ledger: await res.income(head), dr: 0, cr: amt });
        lines.push(...(await gstLines(res, "cr", "output", sum(live, (l) => l.gst), !!payerGstinState && !!ctx.hospitalState && payerGstinState !== ctx.hospitalState)));
        out.push({ key: `bill:${b._id}`, code: b.code, type: "Sales", date: b.billDate, narration: `Hospital bill ${b.code} — ${b.patientName}${payer ? ` (${b.payerName ?? payer.name})` : ""}`, lines });
      }
      for (const r of b.receipts ?? []) {
        const parts = r.splits?.length ? r.splits.filter((s) => s.recon !== "Bounced").map((s) => ({ mode: s.mode, amount: s.amount })) : [{ mode: "Cash", amount: r.amount }];
        const paid = sum(parts, (p) => p.amount);
        const writeOff = r2(r.writeOff ?? 0);
        if (paid <= 0 && writeOff <= 0) continue;
        const refNo = r.splits?.map((s) => s.reference).filter(Boolean).join(", ") || undefined;
        const base = { key: `bill:${b._id}:rcpt:${r.code}`, code: r.code, date: new Date(r.at), refNo };
        if (r.kind === "Refund") {
          out.push({ ...base, type: "Payment", narration: `Refund on bill ${b.code} — ${b.patientName}`, lines: [{ ledger: await res.system("patients"), dr: paid, cr: 0 }, ...(await modeLines(res, "cr", parts))] });
        } else if (r.kind === "Settlement") {
          const party = payer ?? (await res.system("payer_receivables"));
          out.push({
            ...base, type: "Receipt", narration: `Settlement from ${b.payerName ?? party.name} on bill ${b.code}${writeOff ? ` (deduction ₹${writeOff})` : ""}`,
            lines: [...(await modeLines(res, "dr", parts)), { ledger: await res.system("tpa_deductions"), dr: writeOff, cr: 0 }, { ledger: party, dr: 0, cr: r2(paid + writeOff) }],
          });
        } else {
          out.push({ ...base, type: "Receipt", narration: `${r.kind} on bill ${b.code} — ${b.patientName}`, lines: [...(await modeLines(res, "dr", parts)), { ledger: await res.system("patients"), dr: 0, cr: paid }] });
        }
      }
      return out;
    },
  },
  {
    kind: "pharmacy_sale",
    label: "Pharmacy sales",
    find: (f) => Sale.find(f).lean<Doc[]>(),
    async build(raw, res) {
      const s = raw as Doc & { code: string; billDate: Date; status: string; customerName: string; paymentMode: string; netAmount: number; taxableTotal: number; gstTotal: number; paidAmount?: number; payments?: { amount: number; mode: string; reference?: string; at: Date }[] };
      if (s.status === "Cancelled") return [];
      const later = s.payments ?? [];
      const atBilling = Math.max(0, r2((s.paidAmount ?? 0) - sum(later, (p) => p.amount)));
      const out: Draft[] = [
        {
          key: `phs:${s._id}`, code: s.code, type: "Sales", date: s.billDate, narration: `Pharmacy bill ${s.code} — ${s.customerName} (${s.paymentMode})`,
          lines: [
            ...(await modeLines(res, "dr", [{ mode: s.paymentMode === "Credit" ? "Cash" : s.paymentMode, amount: atBilling }])),
            { ledger: await res.system("patients"), dr: r2(s.netAmount - atBilling), cr: 0 },
            { ledger: await res.system("pharmacy_sales"), dr: 0, cr: s.taxableTotal ?? 0 },
            ...(await gstLines(res, "cr", "output", s.gstTotal ?? 0, false)),
          ],
        },
      ];
      for (const [i, p] of later.entries()) {
        out.push({
          key: `phs:${s._id}:pay:${i}`, code: `${s.code}/R${i + 1}`, type: "Receipt", date: new Date(p.at), refNo: p.reference, narration: `Payment on pharmacy bill ${s.code} — ${s.customerName}`,
          lines: [...(await modeLines(res, "dr", [p])), { ledger: await res.system("patients"), dr: 0, cr: p.amount }],
        });
      }
      return out;
    },
  },
  {
    kind: "pharmacy_purchase",
    label: "Pharmacy purchases",
    find: (f) => Purchase.find(f).lean<Doc[]>(),
    async build(raw, res, ctx) {
      const p = raw as Doc & { code: string; status: string; supplier: Types.ObjectId; supplierName?: string; supplierInvoiceNo: string; invoiceDate: Date; taxableTotal: number; gstTotal: number; netAmount: number };
      if (p.status === "Cancelled") return [];
      const supplier = await res.party("supplier", p.supplier, p.supplierName ?? "Supplier");
      const inter = await interState(p.supplier, ctx.hospitalState);
      return [{
        key: `php:${p._id}`, code: p.code, type: "Purchase", date: p.invoiceDate, refNo: p.supplierInvoiceNo, narration: `Pharmacy purchase ${p.code} — ${p.supplierName ?? supplier.name}, invoice ${p.supplierInvoiceNo}`,
        lines: [{ ledger: await res.system("pharmacy_purchases"), dr: p.taxableTotal ?? 0, cr: 0 }, ...(await gstLines(res, "dr", "input", p.gstTotal ?? 0, inter)), { ledger: supplier, dr: 0, cr: p.netAmount }],
      }];
    },
  },
  {
    kind: "stock_doc",
    label: "GRNs & purchase returns",
    find: (f) => StockDoc.find({ ...f, type: { $in: ["grn", "purchase_return"] } }).lean<Doc[]>(),
    async build(raw, res, ctx) {
      const d = raw as Doc & { type: string; code: string; status: string; docDate: Date; invoiceNo?: string; invoiceDate?: Date; supplier?: Types.ObjectId; supplierName?: string; against?: Types.ObjectId; againstCode?: string; taxableTotal: number; gstTotal: number; netAmount: number };
      if (d.status !== "Posted" || !(d.netAmount > 0)) return [];
      let supplierId = d.supplier;
      let supplierName = d.supplierName;
      if (!supplierId && d.against) {
        const grn = await StockDoc.findById(d.against).select("supplier supplierName").lean();
        supplierId = grn?.supplier ?? undefined;
        supplierName = grn?.supplierName ?? undefined;
      }
      const supplier = await res.party("supplier", supplierId, supplierName ?? "Supplier");
      const inter = await interState(supplierId, ctx.hospitalState);
      const purchases = await res.system("store_purchases");
      if (d.type === "grn") {
        return [{
          key: `grn:${d._id}`, code: d.code, type: "Purchase", date: d.invoiceDate ?? d.docDate, refNo: d.invoiceNo, narration: `Goods receipt ${d.code} — ${supplierName ?? supplier.name}${d.invoiceNo ? `, invoice ${d.invoiceNo}` : ""}`,
          lines: [{ ledger: purchases, dr: d.taxableTotal ?? 0, cr: 0 }, ...(await gstLines(res, "dr", "input", d.gstTotal ?? 0, inter)), { ledger: supplier, dr: 0, cr: d.netAmount }],
        }];
      }
      return [{
        key: `prt:${d._id}`, code: d.code, type: "Debit Note", date: d.docDate, refNo: d.againstCode, narration: `Purchase return ${d.code} to ${supplierName ?? supplier.name}${d.againstCode ? ` against ${d.againstCode}` : ""}`,
        lines: [{ ledger: supplier, dr: d.netAmount, cr: 0 }, { ledger: purchases, dr: 0, cr: d.taxableTotal ?? 0 }, ...(await gstLines(res, "cr", "input", d.gstTotal ?? 0, inter))],
      }];
    },
  },
  {
    kind: "supplier_payment",
    label: "Vendor payments",
    deletable: true,
    find: (f) => M("inventory", "supplier_payments").find(f).lean<Doc[]>(),
    exists: (ids) => M("inventory", "supplier_payments").find({ _id: { $in: ids } }).distinct("_id"),
    async build(p, res) {
      const supplier = await res.party("supplier", p.supplier, "Supplier");
      const amount = r2(Number(p.amount ?? 0));
      return [{
        key: `vpy:${p._id}`, code: String(p.code ?? p._id), type: "Payment", date: p.paymentDate as Date, refNo: (p.reference as string) || undefined,
        narration: `Payment to ${supplier.name}${p.billRef ? ` against ${p.billRef}` : " (on account)"}`,
        lines: [{ ledger: supplier, dr: amount, cr: 0 }, ...(await modeLines(res, "cr", [{ mode: p.mode as string, amount }]))],
      }];
    },
  },
  {
    kind: "doctor_payout",
    label: "Doctor payouts",
    deletable: true,
    find: (f) => M("billing", "doctor_payouts").find(f).lean<Doc[]>(),
    exists: (ids) => M("billing", "doctor_payouts").find({ _id: { $in: ids } }).distinct("_id"),
    async build(p, res) {
      const doc = p.doctor ? await M("doctors", "doctors").findById(p.doctor).select("fullName").lean<Doc>() : null;
      const amount = r2(Number(p.amount ?? 0));
      return [{
        key: `dpo:${p._id}`, code: String(p.code ?? p._id), type: "Payment", date: p.paymentDate as Date, refNo: (p.reference as string) || undefined,
        narration: `Doctor payout — ${doc?.fullName ?? "doctor"} for ${iso(p.periodFrom as Date)} to ${iso(p.periodTo as Date)}`,
        lines: [{ ledger: await res.system("doctor_fees"), dr: amount, cr: 0 }, ...(await modeLines(res, "cr", [{ mode: p.mode as string, amount }]))],
      }];
    },
  },
  {
    kind: "staff_advance",
    label: "Staff advances",
    deletable: true,
    find: (f) => M("hr", "advances").find(f).lean<Doc[]>(),
    exists: (ids) => M("hr", "advances").find({ _id: { $in: ids } }).distinct("_id"),
    async build(a, res) {
      const staff = a.staff ? await M("hr", "staff").findById(a.staff).select("fullName").lean<Doc>() : null;
      const amount = r2(Number(a.amount ?? 0));
      return [{
        key: `adv:${a._id}`, code: String(a.code ?? a._id), type: "Payment", date: a.issueDate as Date, refNo: (a.reference as string) || undefined,
        narration: `${a.advanceType ?? "Advance"} to ${staff?.fullName ?? "staff"}`,
        lines: [{ ledger: await res.system("staff_advances"), dr: amount, cr: 0 }, ...(await modeLines(res, "cr", [{ mode: a.mode as string, amount }]))],
      }];
    },
  },
  {
    kind: "lab_order",
    label: "Lab orders",
    find: (f) => LabOrder.find(f).lean<Doc[]>(),
    async build(raw, res) {
      const o = raw as Doc & { code: string; orderDate: Date; status: string; patientName: string; netAmount: number; payments: { kind: string; amount: number; mode: string; reference?: string; at: Date }[] };
      const out: Draft[] = [];
      if (o.status !== "Cancelled" && o.netAmount > 0) {
        out.push({ key: `lab:${o._id}`, code: o.code, type: "Sales", date: o.orderDate, narration: `Lab order ${o.code} — ${o.patientName}`, lines: [{ ledger: await res.system("patients"), dr: o.netAmount, cr: 0 }, { ledger: await res.system("lab_income"), dr: 0, cr: o.netAmount }] });
      }
      for (const [i, p] of (o.payments ?? []).entries()) {
        const refund = p.kind === "Refund";
        out.push({
          key: `lab:${o._id}:pay:${i}`, code: `${o.code}/${refund ? "RF" : "P"}${i + 1}`, type: refund ? "Payment" : "Receipt", date: new Date(p.at), refNo: p.reference,
          narration: `${refund ? "Refund on" : "Payment on"} lab order ${o.code} — ${o.patientName}`,
          lines: refund
            ? [{ ledger: await res.system("patients"), dr: p.amount, cr: 0 }, ...(await modeLines(res, "cr", [p]))]
            : [...(await modeLines(res, "dr", [p])), { ledger: await res.system("patients"), dr: 0, cr: p.amount }],
        });
      }
      return out;
    },
  },
  {
    kind: "ambulance_trip",
    label: "Ambulance trips (collected directly)",
    find: (f) => Trip.find(f).lean<Doc[]>(),
    async build(raw, res) {
      const t = raw as Doc & { code: string; status: string; billingMode?: string; completedAt?: Date; requestedAt: Date; patientName?: string; callerName?: string; charges?: { total?: number }; payments: { mode: string; amount: number; reference?: string; at: Date }[] };
      if (t.billingMode !== "Collect" || t.status !== "Completed") return [];
      const who = t.patientName || t.callerName || "patient";
      const total = r2(t.charges?.total ?? 0);
      const out: Draft[] = [];
      if (total > 0) {
        out.push({ key: `amb:${t._id}`, code: t.code, type: "Sales", date: t.completedAt ?? t.requestedAt, narration: `Ambulance trip ${t.code} — ${who}`, lines: [{ ledger: await res.system("patients"), dr: total, cr: 0 }, { ledger: await res.system("ambulance_income"), dr: 0, cr: total }] });
      }
      for (const [i, p] of (t.payments ?? []).entries()) {
        out.push({
          key: `amb:${t._id}:pay:${i}`, code: `${t.code}/P${i + 1}`, type: "Receipt", date: new Date(p.at), refNo: p.reference, narration: `Payment on ambulance trip ${t.code} — ${who}`,
          lines: [...(await modeLines(res, "dr", [p])), { ledger: await res.system("patients"), dr: 0, cr: p.amount }],
        });
      }
      return out;
    },
  },
  {
    kind: "payroll",
    label: "Payroll (paid runs)",
    find: (f) => PayrollRun.find(f).lean<Doc[]>(),
    async build(raw, res) {
      type Line = { grossEarned?: number; pf?: number; esi?: number; pt?: number; tds?: number; advance?: number; otherDeductions?: number; employerPf?: number; employerEsi?: number; netPay?: number; salaryMode?: string };
      const run = raw as Doc & { code: string; month: string; status: string; paidOn?: Date; periodEnd: Date; paymentReference?: string; lines: Line[] };
      if (run.status !== "Paid") return [];
      const L = run.lines ?? [];
      const byMode = new Map<string, number>();
      for (const l of L) {
        const mode = l.salaryMode === "Cash" ? "Cash" : l.salaryMode === "Cheque" ? "Cheque" : "Bank Transfer";
        byMode.set(mode, r2((byMode.get(mode) ?? 0) + (l.netPay ?? 0)));
      }
      return [{
        key: `pay:${run._id}`, code: run.code, type: "Journal", date: run.paidOn ?? run.periodEnd, refNo: run.paymentReference, narration: `Salaries for ${run.month} (${L.length} employee${L.length === 1 ? "" : "s"})`,
        lines: [
          { ledger: await res.system("salaries"), dr: r2(sum(L, (l) => l.grossEarned ?? 0) - sum(L, (l) => l.otherDeductions ?? 0)), cr: 0 },
          { ledger: await res.system("employer_contribution"), dr: sum(L, (l) => (l.employerPf ?? 0) + (l.employerEsi ?? 0)), cr: 0 },
          { ledger: await res.system("pf_payable"), dr: 0, cr: sum(L, (l) => (l.pf ?? 0) + (l.employerPf ?? 0)) },
          { ledger: await res.system("esi_payable"), dr: 0, cr: sum(L, (l) => (l.esi ?? 0) + (l.employerEsi ?? 0)) },
          { ledger: await res.system("pt_payable"), dr: 0, cr: sum(L, (l) => l.pt ?? 0) },
          { ledger: await res.system("tds_payable"), dr: 0, cr: sum(L, (l) => l.tds ?? 0) },
          { ledger: await res.system("staff_advances"), dr: 0, cr: sum(L, (l) => l.advance ?? 0) },
          ...(await modeLines(res, "cr", [...byMode].map(([mode, amount]) => ({ mode, amount })))),
        ],
      }];
    },
  },
];

const interCache = new Map<string, string>();
/** Is a supplier in another state than the hospital (IGST instead of CGST + SGST)? */
async function interState(supplierId: unknown, hospital: string) {
  if (!supplierId || !hospital) return false;
  const k = String(supplierId);
  if (!interCache.has(k)) {
    const s = await M("inventory", "suppliers").findById(supplierId).select("gstin").lean<Doc>();
    interCache.set(k, stateCodeOf(s?.gstin));
  }
  const st = interCache.get(k)!;
  return !!st && st !== hospital;
}

export const SOURCE_LABELS = Object.fromEntries(SOURCES.map((s) => [s.kind, s.label]));

const BATCH = 300;
const SKEW_MS = 120_000;
const FRESH_MS = 20_000;

declare global {
  var __accountsPosting: Promise<PostingSummary> | null | undefined;
}

export interface PostingSummary {
  full: boolean;
  documents: number;
  vouchers: number;
  removed: number;
  errors: string[];
  at: string;
}

/** Bring automatic vouchers up to date. Concurrent calls share one run. */
export function runPosting(opts: { full?: boolean } = {}): Promise<PostingSummary> {
  const current = globalThis.__accountsPosting;
  if (current) return opts.full ? current.then(() => runPosting(opts)) : current;
  const run = doPosting(!!opts.full).finally(() => {
    globalThis.__accountsPosting = null;
  });
  globalThis.__accountsPosting = run;
  return run;
}

/** Called before every Accounts / GST read: posts what changed, at most every few seconds. */
export async function ensurePosted() {
  if (globalThis.__accountsPosting) {
    await globalThis.__accountsPosting;
    return;
  }
  const state = await AccountsState.findById("main").select("lastRunAt").lean();
  if (state?.lastRunAt && Date.now() - new Date(state.lastRunAt).getTime() < FRESH_MS) return;
  await runPosting();
}

async function doPosting(full: boolean): Promise<PostingSummary> {
  await ensureMasters();
  interCache.clear();
  const startedAt = new Date();
  const state = await loadState();
  const chart = await loadChart();
  const modes = Object.fromEntries(MONEY_MODES.map((m) => [m, ((state.modeLedgers ?? {}) as Record<string, string>)[m] ?? ""]));
  const res = new Resolver(modes, chart);
  const ctx = { hospitalState: await hospitalState() };
  const booksFrom = state.booksFrom ? new Date(state.booksFrom).getTime() : null;
  const checkpoints = { ...((state.checkpoints ?? {}) as Record<string, string>) };
  const summary: PostingSummary = { full, documents: 0, vouchers: 0, removed: 0, errors: [], at: startedAt.toISOString() };

  if (full) summary.removed += (await Voucher.deleteMany({ auto: true })).deletedCount ?? 0;

  for (const src of SOURCES) {
    try {
      const since = !full && checkpoints[src.kind] ? new Date(new Date(checkpoints[src.kind]).getTime() - SKEW_MS) : null;
      const docs = await src.find(since ? { updatedAt: { $gte: since } } : {});
      for (let i = 0; i < docs.length; i += BATCH) {
        const chunk = docs.slice(i, i + BATCH);
        const vouchers = [];
        for (const doc of chunk) {
          try {
            for (const d of await src.build(doc, res, ctx)) {
              if (!(d.date instanceof Date) || Number.isNaN(d.date.getTime())) continue;
              if (booksFrom && d.date.getTime() < booksFrom) continue;
              const v = await finalize(res, d, { kind: src.kind, id: doc._id, code: String(doc.code ?? d.code) });
              if (v) vouchers.push(v);
            }
          } catch (err) {
            summary.errors.push(`${src.label} ${String(doc.code ?? doc._id)}: ${(err as Error).message}`);
          }
        }
        if (!full) summary.removed += (await Voucher.deleteMany({ auto: true, sourceKind: src.kind, sourceId: { $in: chunk.map((d) => d._id) } })).deletedCount ?? 0;
        if (vouchers.length) await Voucher.insertMany(vouchers, { ordered: false });
        summary.documents += chunk.length;
        summary.vouchers += vouchers.length;
      }
      // Records that can be deleted outright leave vouchers behind: sweep them.
      if (src.deletable && src.exists && !full) {
        const posted: Types.ObjectId[] = await Voucher.find({ auto: true, sourceKind: src.kind }).distinct("sourceId");
        const alive = new Set((await src.exists(posted)).map(String));
        const gone = posted.filter((id) => !alive.has(String(id)));
        if (gone.length) summary.removed += (await Voucher.deleteMany({ auto: true, sourceKind: src.kind, sourceId: { $in: gone } })).deletedCount ?? 0;
      }
      checkpoints[src.kind] = startedAt.toISOString();
    } catch (err) {
      console.error(`[accounts] posting ${src.kind} failed:`, err);
      summary.errors.push(`${src.label}: ${(err as Error).message}`);
    }
  }
  await AccountsState.updateOne({ _id: "main" }, { $set: { checkpoints, lastRunAt: new Date(), lastRunSummary: { ...summary, errors: summary.errors.slice(0, 20) } } }, { upsert: true });
  return summary;
}

export async function repostAll(user: SessionUser, req: Request) {
  const summary = await runPosting({ full: true });
  await logActivity({ req, user, action: "update", module: "accounts", resource: "vouchers", summary: `Re-posted all automatic vouchers: ${summary.vouchers} voucher(s) from ${summary.documents} document(s)${summary.errors.length ? `, ${summary.errors.length} error(s)` : ""}` });
  return summary;
}

/* ======================= vouchers ======================= */

const SOURCE_HREF: Record<string, (id: string) => string> = {
  bill: (id) => `/billing/bills/${id}`,
  pharmacy_sale: (id) => `/pharmacy/sales/${id}`,
  pharmacy_purchase: (id) => `/pharmacy/purchases/${id}`,
  stock_doc: (id) => `/inventory/docs/${id}`,
  lab_order: (id) => `/laboratory/orders/${id}`,
  ambulance_trip: (id) => `/ambulance/trips/${id}`,
  supplier_payment: () => "/m/inventory?tab=supplier_payments",
  doctor_payout: () => "/m/billing?tab=doctor_payouts",
  staff_advance: () => "/m/hr?tab=advances",
  payroll: () => "/m/hr?tab=payroll",
};

type VoucherLean = Doc & {
  code: string; type: string; date: Date; amount: number; narration?: string; refNo?: string; auto?: boolean; sourceKind?: string; sourceId?: Types.ObjectId; sourceCode?: string; status: string;
  entries: { ledger: Types.ObjectId; ledgerName: string; dr: number; cr: number; note?: string }[];
  createdByName?: string; createdAt?: Date; cancelReason?: string; cancelledByName?: string; cancelledAt?: Date;
};

function serializeVoucher(v: VoucherLean, names?: Map<string, LedgerInfo>) {
  return {
    id: String(v._id),
    code: v.code,
    type: v.type,
    date: v.date.toISOString(),
    amount: v.amount,
    narration: v.narration ?? "",
    refNo: v.refNo ?? "",
    auto: !!v.auto,
    status: v.status,
    source: v.auto && v.sourceKind ? { kind: v.sourceKind, label: SOURCE_LABELS[v.sourceKind] ?? v.sourceKind, code: v.sourceCode ?? "", href: v.sourceId ? SOURCE_HREF[v.sourceKind]?.(String(v.sourceId)) ?? null : null } : null,
    entries: v.entries.map((e) => ({ ledgerId: String(e.ledger), ledger: names?.get(String(e.ledger))?.name ?? e.ledgerName, dr: e.dr, cr: e.cr, note: e.note ?? "" })),
    createdByName: v.createdByName ?? null,
    createdAt: v.createdAt ? new Date(v.createdAt).toISOString() : null,
    cancelReason: v.cancelReason ?? null,
    cancelledByName: v.cancelledByName ?? null,
  };
}

export async function listVouchers(url: URL) {
  await ensurePosted();
  const sp = url.searchParams;
  const { page, limit, skip } = parsePaging(url, 25);
  const filter: Record<string, unknown> = {};
  const type = sp.get("type");
  if (type && (VOUCHER_TYPES as readonly string[]).includes(type)) filter.type = type;
  const origin = sp.get("origin");
  if (origin === "manual") filter.auto = { $ne: true };
  if (origin === "auto") filter.auto = true;
  const status = sp.get("status");
  filter.status = status === "Cancelled" ? "Cancelled" : status === "all" ? { $in: ["Active", "Cancelled"] } : "Active";
  const from = parseDay(sp.get("from"));
  const to = parseDay(sp.get("to"));
  if (from || to) filter.date = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: new Date(to.getTime() + DAY - 1) } : {}) };
  const ledger = sp.get("ledger");
  if (ledger && isObjectId(ledger)) filter["entries.ledger"] = new Types.ObjectId(ledger);
  const q = sp.get("search")?.trim();
  if (q) {
    const rx = new RegExp(escapeRegex(q.slice(0, 60)), "i");
    filter.$or = [{ code: rx }, { narration: rx }, { refNo: rx }, { sourceCode: rx }, { "entries.ledgerName": rx }];
  }
  const [rows, total, totals] = await Promise.all([
    Voucher.find(filter).sort({ date: -1, createdAt: -1 }).skip(skip).limit(limit).lean<VoucherLean[]>(),
    Voucher.countDocuments(filter),
    Voucher.aggregate<{ _id: string; n: number; amount: number }>([{ $match: filter }, { $group: { _id: "$type", n: { $sum: 1 }, amount: { $sum: "$amount" } } }]),
  ]);
  const chart = await loadChart();
  return {
    data: { rows: rows.map((v) => serializeVoucher(v, chart.ledgers)), byType: totals.map((t) => ({ type: t._id, count: t.n, amount: r2(t.amount) })).sort((a, b) => VOUCHER_TYPES.indexOf(a.type as VoucherType) - VOUCHER_TYPES.indexOf(b.type as VoucherType)) },
    pagination: pagination(page, limit, total),
  };
}

export async function getVoucher(id: string) {
  if (!isObjectId(id)) throw new ApiError(404, "Voucher not found");
  const v = await Voucher.findById(id).lean<VoucherLean>();
  if (!v) throw new ApiError(404, "Voucher not found");
  const chart = await loadChart();
  return serializeVoucher(v, chart.ledgers);
}

/** Validate a manual voucher body against the chart and the voucher type's rules. */
async function parseVoucher(body: Record<string, unknown>, type: VoucherType) {
  const chart = await loadChart();
  const errors: Record<string, string> = {};
  const date = parseDay(body.date);
  if (!date) errors.date = "Enter the voucher date";
  else if (date.getTime() > todayUtc().getTime() + DAY) errors.date = "Voucher date cannot be in the future";
  const narration = typeof body.narration === "string" ? body.narration.trim().slice(0, 500) : "";
  const refNo = typeof body.refNo === "string" ? body.refNo.trim().slice(0, 60) : "";
  const raw = Array.isArray(body.entries) ? body.entries : [];
  if (raw.length < 2) errors.entries = "A voucher needs at least one debit and one credit line";
  if (raw.length > 100) errors.entries = "A voucher can have at most 100 lines";
  const entries: { ledger: Types.ObjectId; ledgerName: string; dr: number; cr: number; note?: string; info: LedgerInfo }[] = [];
  raw.forEach((r, i) => {
    const e = (r ?? {}) as Record<string, unknown>;
    const l = chart.ledgers.get(String(e.ledger ?? ""));
    const dr = r2(Number(e.dr) || 0);
    const cr = r2(Number(e.cr) || 0);
    const k = `entries.${i}`;
    if (!l) return void (errors[k] = "Choose a ledger");
    if (l.status !== "Active") return void (errors[k] = `${l.name} is inactive`);
    if (dr < 0 || cr < 0 || (dr > 0) === (cr > 0)) return void (errors[k] = "Enter either a debit or a credit amount");
    if (dr > 1e11 || cr > 1e11) return void (errors[k] = "Amount is too large");
    entries.push({ ledger: new Types.ObjectId(l.id), ledgerName: l.name, dr, cr, note: typeof e.note === "string" ? e.note.trim().slice(0, 200) || undefined : undefined, info: l });
  });
  if (Object.keys(errors).length) fail(errors);
  const dr = r2(entries.reduce((s, e) => s + e.dr, 0));
  const cr = r2(entries.reduce((s, e) => s + e.cr, 0));
  if (dr !== cr) fail({ entries: `Debits (₹${dr}) and credits (₹${cr}) must be equal — difference ₹${r2(dr - cr)}` });
  if (!entries.some((e) => e.dr > 0) || !entries.some((e) => e.cr > 0)) fail({ entries: "Enter at least one debit and one credit" });
  if (type === "Contra" && entries.some((e) => !isCashBank(e.info))) fail({ entries: "Contra vouchers only move money between cash and bank ledgers" });
  if (type === "Receipt" && !entries.some((e) => e.dr > 0 && isCashBank(e.info))) fail({ entries: "A receipt must debit a cash or bank ledger" });
  if (type === "Payment" && !entries.some((e) => e.cr > 0 && isCashBank(e.info))) fail({ entries: "A payment must credit a cash or bank ledger" });
  return { date: date!, narration, refNo, entries: entries.map((e) => ({ ledger: e.ledger, ledgerName: e.ledgerName, dr: e.dr, cr: e.cr, note: e.note })), amount: dr };
}

async function nextVoucherCode(type: VoucherType, date: Date) {
  const fy = financialYear(date);
  const n = await nextSerial(`VCH-${VOUCHER_PREFIX[type]}-${fy}`);
  return `${VOUCHER_PREFIX[type]}/${fy}/${String(n).padStart(5, "0")}`;
}

export async function createVoucher(body: Record<string, unknown>, user: SessionUser, req: Request) {
  const type = String(body.type ?? "") as VoucherType;
  if (!(VOUCHER_TYPES as readonly string[]).includes(type)) fail({ type: "Choose the voucher type" });
  const v = await parseVoucher(body, type);
  const doc = await Voucher.create({ ...v, type, code: await nextVoucherCode(type, v.date), auto: false, status: "Active", createdBy: user.id, createdByName: user.name });
  await logActivity({ req, user, action: "create", module: "accounts", resource: "vouchers", entityId: String(doc._id), entityLabel: doc.code, summary: `Created ${type} voucher ${doc.code} for ₹${v.amount}${v.narration ? ` — ${v.narration.slice(0, 80)}` : ""}` });
  return getVoucher(String(doc._id));
}

async function manualVoucher(id: string) {
  if (!isObjectId(id)) throw new ApiError(404, "Voucher not found");
  const v = await Voucher.findById(id);
  if (!v) throw new ApiError(404, "Voucher not found");
  if (v.auto) throw new ApiError(409, "This voucher is posted automatically from its source document. Change or cancel the source instead.");
  if (v.status === "Cancelled") throw new ApiError(409, "This voucher is cancelled");
  return v;
}

export async function updateVoucher(id: string, body: Record<string, unknown>, user: SessionUser, req: Request) {
  const v = await manualVoucher(id);
  const parsed = await parseVoucher(body, v.type as VoucherType);
  Object.assign(v, parsed, { updatedByName: user.name });
  await v.save();
  await logActivity({ req, user, action: "update", module: "accounts", resource: "vouchers", entityId: id, entityLabel: v.code, summary: `Edited ${v.type} voucher ${v.code} — ₹${parsed.amount}` });
  return getVoucher(id);
}

export async function cancelVoucher(id: string, reason: string, user: SessionUser, req: Request) {
  const v = await manualVoucher(id);
  if (reason.trim().length < 3) fail({ reason: "Enter the reason for cancelling" });
  Object.assign(v, { status: "Cancelled", cancelledAt: new Date(), cancelReason: reason.trim().slice(0, 300), cancelledByName: user.name });
  await v.save();
  await logActivity({ req, user, action: "update", module: "accounts", resource: "vouchers", entityId: id, entityLabel: v.code, summary: `Cancelled ${v.type} voucher ${v.code} (₹${v.amount}). Reason: ${reason.trim()}` });
  return getVoucher(id);
}

/* ======================= books & final accounts ======================= */

/** Debit and credit totals per ledger for vouchers matching `match`. */
async function movements(match: Record<string, unknown>) {
  const rows = await Voucher.aggregate<{ _id: Types.ObjectId; dr: number; cr: number }>([
    { $match: { status: "Active", ...match } },
    { $unwind: "$entries" },
    { $group: { _id: "$entries.ledger", dr: { $sum: "$entries.dr" }, cr: { $sum: "$entries.cr" } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), { dr: r2(r.dr), cr: r2(r.cr) }]));
}

/** Value of stock at cost at the end of `at`: today's batch value less movements since. */
async function stockValue(at: Date) {
  const [now] = await M("inventory", "batches").aggregate<{ v: number }>([{ $group: { _id: null, v: { $sum: { $multiply: [{ $ifNull: ["$quantity", 0] }, { $ifNull: ["$purchaseRate", 0] }] } } } }]);
  if (at.getTime() >= Date.now()) return r2(now?.v ?? 0);
  const [after] = await StockLedger.aggregate<{ v: number }>([{ $match: { at: { $gt: at } } }, { $group: { _id: null, v: { $sum: "$value" } } }]);
  return r2(Math.max(0, (now?.v ?? 0) - (after?.v ?? 0)));
}

/** Stock brought in without a purchase (Inventory "Stock Entry": opening stock, donations, found stock), at cost. */
async function stockIntroduced(from: Date, end: Date) {
  const [r] = await StockLedger.aggregate<{ v: number }>([{ $match: { docType: "opening", at: { $gte: from, $lte: end } } }, { $group: { _id: null, v: { $sum: "$value" } } }]);
  return r2(r?.v ?? 0);
}

async function booksStart() {
  const state = await loadState();
  if (state.booksFrom) return new Date(state.booksFrom);
  const first = await Voucher.findOne({ status: "Active" }).sort({ date: 1 }).select("date").lean();
  return first?.date ? new Date(first.date) : todayUtc();
}

const PRIMARY_ORDER = GROUP_SEEDS.filter((g) => !g.parent).map((g) => g.key);

export async function trialBalance(url: URL) {
  await ensurePosted();
  const { from, to, end } = reportRange(url);
  const chart = await loadChart();
  const [before, period] = await Promise.all([movements({ date: { $lt: from } }), movements({ date: { $gte: from, $lte: end } })]);
  let plBefore = 0;
  const rows: { id: string; name: string; group: string; primary: string; opening: number; dr: number; cr: number; closing: number }[] = [];
  for (const l of chart.ledgers.values()) {
    const b = before.get(l.id) ?? { dr: 0, cr: 0 };
    const p = period.get(l.id) ?? { dr: 0, cr: 0 };
    let opening = r2(l.opening + b.dr - b.cr);
    // Income and expenses start afresh each period; earlier results sit in the P&L account.
    if (isNominal(l)) {
      plBefore = r2(plBefore + opening);
      opening = 0;
    }
    const closing = r2(opening + p.dr - p.cr);
    if (opening === 0 && p.dr === 0 && p.cr === 0) continue;
    rows.push({ id: l.id, name: l.name, group: l.groupName, primary: l.primary, opening, dr: p.dr, cr: p.cr, closing });
  }
  const sections = PRIMARY_ORDER.map((key) => {
    const list = rows.filter((r) => r.primary === key).sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
    return { key, name: SEED_BY_KEY.get(key)!.name, rows: list, opening: sum(list, (r) => r.opening), dr: sum(list, (r) => r.dr), cr: sum(list, (r) => r.cr), closing: sum(list, (r) => r.closing) };
  }).filter((s) => s.rows.length);
  if (plBefore !== 0) sections.unshift({ key: "pl", name: "Profit & Loss A/c (earlier periods)", rows: [], opening: plBefore, dr: 0, cr: 0, closing: plBefore });
  const totals = {
    opening: sum(sections, (s) => s.opening),
    dr: sum(sections, (s) => s.dr),
    cr: sum(sections, (s) => s.cr),
    closingDr: sum(sections.flatMap((s) => (s.rows.length ? s.rows.map((r) => r.closing) : [s.closing])), (c) => (c > 0 ? c : 0)),
    closingCr: sum(sections.flatMap((s) => (s.rows.length ? s.rows.map((r) => r.closing) : [s.closing])), (c) => (c < 0 ? -c : 0)),
  };
  return { from: iso(from), to: iso(to), sections, totals, difference: r2(totals.closingDr - totals.closingCr) };
}

function nominalRows(chart: Awaited<ReturnType<typeof loadChart>>, mov: Map<string, { dr: number; cr: number }>, primaries: string[], sign: 1 | -1) {
  const rows = [...chart.ledgers.values()]
    .filter((l) => primaries.includes(l.primary))
    .map((l) => {
      const m = mov.get(l.id) ?? { dr: 0, cr: 0 };
      return { id: l.id, name: l.name, group: l.groupName, primary: l.primary, amount: r2(sign * (m.dr - m.cr)) };
    })
    .filter((r) => r.amount !== 0)
    .sort((a, b) => b.amount - a.amount);
  return { rows, total: sum(rows, (r) => r.amount) };
}

async function profitFor(from: Date, end: Date) {
  const chart = await loadChart();
  const mov = await movements({ date: { $gte: from, $lte: end } });
  const [openingStock, closingStock, introduced] = await Promise.all([stockValue(new Date(from.getTime() - 1)), stockValue(end), stockIntroduced(from, end)]);
  const sales = nominalRows(chart, mov, ["sales"], -1);
  const directIncome = nominalRows(chart, mov, ["direct_income"], -1);
  const purchases = nominalRows(chart, mov, ["purchases"], 1);
  const directExpenses = nominalRows(chart, mov, ["direct_expenses"], 1);
  const indirectIncome = nominalRows(chart, mov, ["indirect_income"], -1);
  const indirectExpenses = nominalRows(chart, mov, ["indirect_expenses"], 1);
  // Stock entered without a purchase is not earned: it sits beside opening stock on the debit side.
  const grossProfit = r2(sales.total + directIncome.total + closingStock - openingStock - introduced - purchases.total - directExpenses.total);
  const netProfit = r2(grossProfit + indirectIncome.total - indirectExpenses.total);
  return { openingStock, stockIntroduced: introduced, closingStock, sales, directIncome, purchases, directExpenses, indirectIncome, indirectExpenses, grossProfit, netProfit };
}

export async function profitLoss(url: URL) {
  await ensurePosted();
  const { from, to, end } = reportRange(url);
  return { from: iso(from), to: iso(to), ...(await profitFor(from, end)) };
}

export async function balanceSheet(url: URL) {
  await ensurePosted();
  const asOf = parseDay(url.searchParams.get("to")) ?? todayUtc();
  const end = new Date(asOf.getTime() + DAY - 1);
  const chart = await loadChart();
  const mov = await movements({ date: { $lte: end } });
  const start = await booksStart();
  const [closingStock, openingStock, introduced] = await Promise.all([stockValue(end), stockValue(new Date(start.getTime() - 1)), stockIntroduced(start, end)]);

  let nominal = 0;
  const bal = new Map<string, number>();
  for (const l of chart.ledgers.values()) {
    const m = mov.get(l.id) ?? { dr: 0, cr: 0 };
    const b = r2(l.opening + m.dr - m.cr);
    if (isNominal(l)) nominal = r2(nominal + b);
    else if (b !== 0) bal.set(l.id, b);
  }
  const profit = r2(-nominal + closingStock - openingStock - introduced);

  const side = (keys: string[], sign: 1 | -1) =>
    keys.map((key) => {
      const ledgers = [...chart.ledgers.values()].filter((l) => l.primary === key && bal.has(l.id));
      const byGroup = new Map<string, { name: string; amount: number }[]>();
      for (const l of ledgers) {
        const list = byGroup.get(l.groupName) ?? [];
        list.push({ name: l.name, amount: r2(sign * bal.get(l.id)!) });
        byGroup.set(l.groupName, list);
      }
      const groups = [...byGroup].map(([name, rows]) => ({ name, rows: rows.sort((a, b) => b.amount - a.amount), total: sum(rows, (r) => r.amount) }));
      return { key, name: SEED_BY_KEY.get(key)!.name, groups, total: sum(groups, (g) => g.total) };
    });

  const liabilities = side(["capital", "loans", "current_liabilities", "suspense"], -1);
  const assets = side(["fixed_assets", "investments", "current_assets"], 1);
  const ca = assets.find((a) => a.key === "current_assets")!;
  if (closingStock) {
    ca.groups.unshift({ name: "Stock-in-Hand", rows: [{ name: "Closing stock (at cost)", amount: closingStock }], total: closingStock });
    ca.total = r2(ca.total + closingStock);
  }
  const liabTotal = r2(sum(liabilities, (s) => s.total) + profit);
  const assetTotal = sum(assets, (s) => s.total);
  const difference = r2(assetTotal - liabTotal);
  return {
    asOf: iso(asOf),
    booksFrom: iso(start),
    liabilities: liabilities.filter((s) => s.groups.length),
    assets: assets.filter((s) => s.groups.length),
    profit,
    openingStock,
    closingStock,
    difference,
    total: r2(Math.max(assetTotal, liabTotal)),
  };
}

export async function ledgerStatement(url: URL) {
  await ensurePosted();
  const id = url.searchParams.get("ledger") ?? "";
  const chart = await loadChart();
  const l = chart.ledgers.get(id);
  if (!l) throw new ApiError(422, "Choose a ledger");
  const { from, to, end } = reportRange(url);
  const lid = new Types.ObjectId(id);
  const [before] = await Voucher.aggregate<{ dr: number; cr: number }>([
    { $match: { status: "Active", date: { $lt: from }, "entries.ledger": lid } },
    { $unwind: "$entries" },
    { $match: { "entries.ledger": lid } },
    { $group: { _id: null, dr: { $sum: "$entries.dr" }, cr: { $sum: "$entries.cr" } } },
  ]);
  const opening = r2(l.opening + (before?.dr ?? 0) - (before?.cr ?? 0));
  const MAX = 3000;
  const vouchers = await Voucher.find({ status: "Active", date: { $gte: from, $lte: end }, "entries.ledger": lid }).sort({ date: 1, createdAt: 1 }).limit(MAX + 1).lean<VoucherLean[]>();
  if (vouchers.length > MAX) throw new ApiError(422, `More than ${MAX} entries in this period — choose a shorter date range`);
  let running = opening;
  const rows = vouchers.map((v) => {
    const mine = v.entries.filter((e) => String(e.ledger) === id);
    const dr = sum(mine, (e) => e.dr);
    const cr = sum(mine, (e) => e.cr);
    running = r2(running + dr - cr);
    const others = v.entries.filter((e) => String(e.ledger) !== id).map((e) => chart.ledgers.get(String(e.ledger))?.name ?? e.ledgerName);
    return {
      id: String(v._id), date: v.date.toISOString(), code: v.code, type: v.type, auto: !!v.auto,
      particulars: others.length > 2 ? `${others.slice(0, 2).join(", ")} +${others.length - 2}` : others.join(", "),
      narration: v.narration ?? "", dr, cr, balance: running,
    };
  });
  return {
    ledger: { id: l.id, name: l.name, group: l.groupName, gstin: l.gstin, phone: l.phone, nature: l.nature },
    from: iso(from), to: iso(to), opening, rows, dr: sum(rows, (r) => r.dr), cr: sum(rows, (r) => r.cr), closing: running,
  };
}

export async function cashBankSummary(url: URL) {
  await ensurePosted();
  const { from, to, end } = reportRange(url);
  const chart = await loadChart();
  const [before, period] = await Promise.all([movements({ date: { $lt: from } }), movements({ date: { $gte: from, $lte: end } })]);
  const rows = [...chart.ledgers.values()].filter(isCashBank).map((l) => {
    const b = before.get(l.id) ?? { dr: 0, cr: 0 };
    const p = period.get(l.id) ?? { dr: 0, cr: 0 };
    const opening = r2(l.opening + b.dr - b.cr);
    return { id: l.id, name: l.name, group: l.groupName, opening, receipts: p.dr, payments: p.cr, closing: r2(opening + p.dr - p.cr) };
  });
  return { from: iso(from), to: iso(to), rows, totals: { opening: sum(rows, (r) => r.opening), receipts: sum(rows, (r) => r.receipts), payments: sum(rows, (r) => r.payments), closing: sum(rows, (r) => r.closing) } };
}

export async function outstanding(url: URL) {
  await ensurePosted();
  const asOf = parseDay(url.searchParams.get("to")) ?? todayUtc();
  const chart = await loadChart();
  const mov = await movements({ date: { $lte: new Date(asOf.getTime() + DAY - 1) } });
  const list = (key: string, sign: 1 | -1) =>
    [...chart.ledgers.values()]
      .filter((l) => l.path.includes(key))
      .map((l) => {
        const m = mov.get(l.id) ?? { dr: 0, cr: 0 };
        return { id: l.id, name: l.name, group: l.groupName, gstin: l.gstin, phone: l.phone, balance: r2(sign * (l.opening + m.dr - m.cr)) };
      })
      .filter((r) => r.balance !== 0)
      .sort((a, b) => b.balance - a.balance);
  const receivables = list("debtors", 1);
  const payables = list("creditors", -1);
  return { asOf: iso(asOf), receivables, payables, totals: { receivables: sum(receivables, (r) => r.balance), payables: sum(payables, (r) => r.balance) } };
}

export const ACCOUNTS_REPORTS = {
  trial: trialBalance,
  pl: profitLoss,
  bs: balanceSheet,
  ledger: ledgerStatement,
  cashbank: cashBankSummary,
  outstanding,
} as const;
