import "server-only";
import mongoose, { Types } from "mongoose";
import { ApiError, escapeRegex, pagination, parsePaging, readJson } from "./api";
import { logActivity } from "./audit";
import { connectDB } from "./db";
import { MODULES, getModule, getResource, patientLinkedResources, resolveRef, type ModuleDef, type RecordValues, type ResourceDef } from "./modules";
import { RULES } from "./rules";
import { canAccess, requireUser, type SessionUser } from "./session";
import { isObjectId, validateRecord } from "./validation";
import { nextCode } from "@/models/Counter";
import { Sale } from "@/models/pharmacy";
import { getRecordModel } from "@/models/records";

export interface RefValue {
  id: string;
  label: string;
  code?: string;
}

export type SerializedRecord = Record<string, unknown> & { id: string; createdAt?: string; updatedAt?: string };

type Doc = Record<string, unknown> & { _id: Types.ObjectId };

export function resolve(moduleKey: string, resourceKey: string): { module: ModuleDef; resource: ResourceDef } {
  const mod = getModule(moduleKey);
  const resource = getResource(moduleKey, resourceKey);
  if (!mod || !resource) throw new ApiError(404, "Unknown module or resource");
  return { module: mod, resource };
}

function model(mod: ModuleDef, resource: ResourceDef) {
  return getRecordModel(mod.key, resource.key)!;
}

function rulesFor(mod: ModuleDef, resource: ResourceDef) {
  return RULES[`${mod.key}.${resource.key}`] ?? {};
}

function assertWritable(resource: ResourceDef) {
  if (resource.readOnly) throw new ApiError(405, `${resource.label} are maintained automatically and cannot be edited here.`);
}

function refPopulate(resource: ResourceDef) {
  return resource.fields
    .filter((f) => f.type === "ref" && f.ref)
    .map((f) => {
      const target = resolveRef(f.ref!)!.resource;
      return { path: f.name, select: [target.labelField, "code"].join(" ") };
    });
}

export function recordLabel(resource: ResourceDef, doc: Record<string, unknown>): string {
  const label = doc[resource.labelField];
  const code = doc.code as string | undefined;
  if (code && resource.labelField !== "code" && label) return `${code} · ${label}`;
  return String(code ?? label ?? doc._id ?? "");
}

export function serialize(resource: ResourceDef, doc: Doc): SerializedRecord {
  const out: SerializedRecord = { id: String(doc._id) };
  if (resource.codePrefix) out.code = doc.code ?? null;
  for (const field of resource.fields) {
    const v = doc[field.name];
    if (field.type === "ref") {
      if (v && typeof v === "object" && "_id" in (v as object)) {
        const target = resolveRef(field.ref!)!.resource;
        const ref = v as Doc;
        out[field.name] = { id: String(ref._id), label: String(ref[target.labelField] ?? ref.code ?? ""), code: ref.code as string | undefined } satisfies RefValue;
      } else {
        out[field.name] = v ? { id: String(v), label: "(deleted)" } : null;
      }
    } else if (v instanceof Date) {
      out[field.name] = v.toISOString();
    } else {
      out[field.name] = v ?? null;
    }
  }
  out.createdAt = (doc.createdAt as Date | undefined)?.toISOString();
  out.updatedAt = (doc.updatedAt as Date | undefined)?.toISOString();
  return out;
}

/** Ensure every ref value points at an existing record of the right resource. */
async function checkRefs(resource: ResourceDef, values: RecordValues) {
  const errors: Record<string, string> = {};
  for (const field of resource.fields) {
    if (field.type !== "ref" || !values[field.name]) continue;
    const target = resolveRef(field.ref!)!;
    const exists = await model(target.module, target.resource).exists({ _id: values[field.name] });
    if (!exists) errors[field.name] = `${field.label} not found`;
  }
  if (Object.keys(errors).length) throw new ApiError(422, "Validation failed", errors);
}

function buildFilter(resource: ResourceDef, url: URL) {
  const filter: Record<string, unknown> = {};
  const q = url.searchParams.get("search")?.trim();
  if (q) {
    const rx = new RegExp(escapeRegex(q.slice(0, 100)), "i");
    const or: Record<string, unknown>[] = resource.fields.filter((f) => f.search).map((f) => ({ [f.name]: rx }));
    if (resource.codePrefix) or.push({ code: rx });
    if (or.length) filter.$or = or;
  }
  for (const field of resource.fields) {
    const v = url.searchParams.get(field.name);
    if (!v) continue;
    if (field.type === "select" && field.options?.includes(v)) filter[field.name] = v;
    else if (field.type === "ref" && isObjectId(v)) filter[field.name] = new Types.ObjectId(v);
  }
  const from = url.searchParams.get("createdFrom");
  if (from && !Number.isNaN(Date.parse(from))) filter.createdAt = { $gte: new Date(from) };
  return filter;
}

export async function listRecords(moduleKey: string, resourceKey: string, req: Request, url = new URL(req.url)) {
  const { module: mod, resource } = resolve(moduleKey, resourceKey);
  await requireUser({ module: mod.key });
  await connectDB();
  await rulesFor(mod, resource).beforeList?.();

  const { page, limit, skip } = parsePaging(url);
  const filter = buildFilter(resource, url);
  const sortField = url.searchParams.get("sort");
  const sortable = new Set(["createdAt", "updatedAt", "code", ...resource.fields.filter((f) => f.type !== "ref").map((f) => f.name)]);
  const sort: Record<string, 1 | -1> = { [sortField && sortable.has(sortField) ? sortField : "createdAt"]: url.searchParams.get("order") === "asc" ? 1 : -1 };

  const M = model(mod, resource);
  const [docs, total] = await Promise.all([
    M.find(filter).sort(sort).skip(skip).limit(limit).populate(refPopulate(resource)).lean<Doc[]>(),
    M.countDocuments(filter),
  ]);
  return { items: docs.map((d) => serialize(resource, d)), pagination: pagination(page, limit, total) };
}

export async function getRecord(moduleKey: string, resourceKey: string, id: string, req: Request) {
  const { module: mod, resource } = resolve(moduleKey, resourceKey);
  const user = await requireUser({ module: mod.key });
  if (!isObjectId(id)) throw new ApiError(404, `${resource.singular} not found`);
  await connectDB();
  const doc = await model(mod, resource).findById(id).populate(refPopulate(resource)).lean<Doc>();
  if (!doc) throw new ApiError(404, `${resource.singular} not found`);

  // Patient records are sensitive: record every time one is opened.
  if (mod.key === "patients") {
    await logActivity({
      req, user, action: "view", module: mod.key, resource: resource.key,
      entityId: id, entityLabel: recordLabel(resource, doc), summary: `Viewed ${resource.singular.toLowerCase()} ${recordLabel(resource, doc)}`,
    });
  }
  return serialize(resource, doc);
}

export async function createRecord(moduleKey: string, resourceKey: string, req: Request) {
  const { module: mod, resource } = resolve(moduleKey, resourceKey);
  const user = await requireUser({ module: mod.key });
  assertWritable(resource);
  const body = await readJson(req);

  const { values, errors } = validateRecord(resource, body);
  if (Object.keys(errors).length) throw new ApiError(422, "Please correct the highlighted fields", errors);

  await connectDB();
  await checkRefs(resource, values);
  const rules = rulesFor(mod, resource);
  await rules.beforeSave?.(values, null);

  const doc: Record<string, unknown> = { ...values, createdBy: user.id, updatedBy: user.id };
  let created;
  try {
    if (resource.codePrefix) doc.code = await nextCode(resource.codePrefix);
    created = await model(mod, resource).create(doc);
  } catch (err) {
    await rules.rollback?.(values, null);
    throw err;
  }
  await rules.afterSave?.(created.toObject() as Doc, null);
  const saved = await model(mod, resource).findById(created._id).populate(refPopulate(resource)).lean<Doc>();

  const label = recordLabel(resource, saved!);
  await logActivity({
    req, user, action: "create", module: mod.key, resource: resource.key,
    entityId: String(created._id), entityLabel: label, summary: `Created ${resource.singular.toLowerCase()} ${label}`,
  });
  return serialize(resource, saved!);
}

function sameValue(a: unknown, b: unknown) {
  if (a instanceof Date || b instanceof Date) return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  if (a == null || b == null) return a == null && b == null;
  return String(a) === String(b);
}

export async function updateRecord(moduleKey: string, resourceKey: string, id: string, req: Request) {
  const { module: mod, resource } = resolve(moduleKey, resourceKey);
  const user = await requireUser({ module: mod.key });
  assertWritable(resource);
  if (!isObjectId(id)) throw new ApiError(404, `${resource.singular} not found`);
  const body = await readJson(req);

  await connectDB();
  const M = model(mod, resource);
  const existing = await M.findById(id).lean<Doc>();
  if (!existing) throw new ApiError(404, `${resource.singular} not found`);

  const { values, errors } = validateRecord(resource, body, { partial: true, existing: existing as RecordValues });
  if (Object.keys(errors).length) throw new ApiError(422, "Please correct the highlighted fields", errors);
  await checkRefs(resource, values);
  const rules = rulesFor(mod, resource);
  await rules.beforeSave?.(values, existing);

  const changed = Object.keys(values).filter((k) => !sameValue(values[k], existing[k]));
  if (changed.length === 0) {
    const doc = await M.findById(id).populate(refPopulate(resource)).lean<Doc>();
    return serialize(resource, doc!);
  }

  const $set: Record<string, unknown> = { updatedBy: user.id };
  const $unset: Record<string, 1> = {};
  for (const k of changed) {
    if (values[k] === null) $unset[k] = 1;
    else $set[k] = values[k];
  }
  const doc = await M.findByIdAndUpdate(id, { $set, ...(Object.keys($unset).length ? { $unset } : {}) }, { returnDocument: "after", runValidators: true })
    .populate(refPopulate(resource))
    .lean<Doc>();
  await rules.afterSave?.((await M.findById(id).lean<Doc>())!, existing);

  const label = recordLabel(resource, doc!);
  const labels = changed.map((k) => resource.fields.find((f) => f.name === k)?.label ?? k);
  await logActivity({
    req, user, action: "update", module: mod.key, resource: resource.key, entityId: id, entityLabel: label,
    changedFields: changed, summary: `Updated ${resource.singular.toLowerCase()} ${label} (${labels.join(", ")})`,
  });
  return serialize(resource, doc!);
}

/** Every resource field (in any module) that references `module.resource`. */
function incomingRefs(moduleKey: string, resourceKey: string) {
  const key = `${moduleKey}.${resourceKey}`;
  const out: { module: ModuleDef; resource: ResourceDef; field: string }[] = [];
  for (const m of MODULES) for (const r of m.resources) for (const f of r.fields) if (f.type === "ref" && f.ref === key) out.push({ module: m, resource: r, field: f.name });
  return out;
}

export async function deleteRecord(moduleKey: string, resourceKey: string, id: string, req: Request) {
  const { module: mod, resource } = resolve(moduleKey, resourceKey);
  const user = await requireUser({ module: mod.key });
  assertWritable(resource);
  if (!isObjectId(id)) throw new ApiError(404, `${resource.singular} not found`);
  await connectDB();
  const M = model(mod, resource);
  const existing = await M.findById(id).lean<Doc>();
  if (!existing) throw new ApiError(404, `${resource.singular} not found`);

  for (const ref of incomingRefs(mod.key, resource.key)) {
    const count = await model(ref.module, ref.resource).countDocuments({ [ref.field]: existing._id });
    if (count > 0) {
      throw new ApiError(409, `Cannot delete: ${count} ${ref.resource.label.toLowerCase()} record(s) in ${ref.module.label} still reference this ${resource.singular.toLowerCase()}.`);
    }
  }

  const rules = rulesFor(mod, resource);
  await rules.beforeDelete?.(existing);
  await M.deleteOne({ _id: existing._id });
  await rules.afterDelete?.(existing);
  const label = recordLabel(resource, existing);
  await logActivity({
    req, user, action: "delete", module: mod.key, resource: resource.key, entityId: id, entityLabel: label,
    summary: `Deleted ${resource.singular.toLowerCase()} ${label}`,
  });
  return { id };
}

/** Record counts for a module's dashboard / monitoring tiles. */
export async function moduleCounts(mod: ModuleDef) {
  const fromResources = mod.resources.map(async (r) => ({ key: r.key, label: r.label, count: await model(mod, r).estimatedDocumentCount() }));
  const fromCollections = (mod.collections ?? []).map(async (c) => ({
    key: c.name, label: c.label, count: await mongoose.connection.collection(c.name).estimatedDocumentCount(),
  }));
  return Promise.all([...fromResources, ...fromCollections]);
}

/** Records in other modules linked to a patient, limited to modules the viewer may open. */
export async function patientRelated(user: SessionUser, patientId: string) {
  const sections: { module: string; moduleLabel: string; resource: string; label: string; total: number; items: SerializedRecord[] }[] = [];
  const restricted: string[] = [];
  const oid = new Types.ObjectId(patientId);
  for (const { module: m, resource: r, field } of patientLinkedResources()) {
    if (!canAccess(user, m.key)) {
      restricted.push(`${m.label} – ${r.label}`);
      continue;
    }
    const M = model(m, r);
    const [docs, total] = await Promise.all([
      M.find({ [field.name]: oid }).sort({ createdAt: -1 }).limit(10).populate(refPopulate(r)).lean<Doc[]>(),
      M.countDocuments({ [field.name]: oid }),
    ]);
    sections.push({ module: m.key, moduleLabel: m.label, resource: r.key, label: r.label, total, items: docs.map((d) => serialize(r, d)) });
  }

  let pharmacy: { total: number; items: Record<string, unknown>[] } | null = null;
  if (canAccess(user, "pharmacy")) {
    const [docs, total] = await Promise.all([
      Sale.find({ patient: oid }).sort({ billDate: -1 }).limit(10).select("code billDate netAmount paidAmount status paymentMode items.itemName").lean(),
      Sale.countDocuments({ patient: oid }),
    ]);
    pharmacy = {
      total,
      items: docs.map((d) => ({
        id: String(d._id), code: d.code, billDate: d.billDate?.toISOString(), netAmount: d.netAmount, paidAmount: d.paidAmount,
        status: d.status, paymentMode: d.paymentMode, summary: d.items.map((i) => i.itemName).slice(0, 3).join(", ") + (d.items.length > 3 ? ` +${d.items.length - 3}` : ""),
      })),
    };
  } else {
    restricted.push("Pharmacy – Sale Bills");
  }
  return { sections, restricted, pharmacy };
}

function lookupSub(resource: ResourceDef, d: Doc) {
  const parts = (resource.lookupFields ?? []).map((name) => {
    const v = d[name];
    if (v instanceof Date) return `exp ${v.toISOString().slice(0, 10)}`;
    return v == null || v === "" ? null : String(v);
  });
  return parts.filter(Boolean).join(" · ") || undefined;
}

export async function lookup(moduleKey: string, resourceKey: string, q: string) {
  const { module: mod, resource } = resolve(moduleKey, resourceKey);
  if (!resource.lookup) throw new ApiError(404, "Lookup not available");
  await requireUser();
  await connectDB();
  await rulesFor(mod, resource).beforeList?.();

  const filter: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(resource.lookupFilter ?? {})) filter[k] = v.includes("|") ? { $in: v.split("|") } : v;
  if (q) {
    const rx = new RegExp(escapeRegex(q.slice(0, 100)), "i");
    const textual = new Set(["text", "tel", "email", "select"]);
    const or: Record<string, unknown>[] = [{ [resource.labelField]: rx }];
    if (resource.codePrefix) or.push({ code: rx });
    for (const name of resource.lookupFields ?? []) {
      const f = resource.fields.find((x) => x.name === name);
      if (f && textual.has(f.type)) or.push({ [name]: rx });
    }
    filter.$or = or;
  }
  const select = [resource.labelField, "code", ...(resource.lookupFields ?? [])].join(" ");
  const docs = await model(mod, resource).find(filter).sort({ createdAt: -1 }).limit(15).select(select).lean<Doc[]>();
  // Only identifying fields are exposed here so admins of other modules can link records.
  return docs.map((d) => ({ id: String(d._id), label: String(d[resource.labelField] ?? ""), code: d.code as string | undefined, sub: lookupSub(resource, d) }));
}
