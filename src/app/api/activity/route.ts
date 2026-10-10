import { Types } from "mongoose";
import { escapeRegex, handle, ok, pagination, parsePaging } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { isObjectId } from "@/lib/validation";
import { ACTIONS, ActivityLog } from "@/models/ActivityLog";

/**
 * Audit trail for the super admin.
 * GET /api/activity?actor=<id>&module=billing&action=update&from=2026-10-01&to=2026-10-10&search=INV&page=1
 */
export const GET = handle(async (req) => {
  await requireUser({ superAdmin: true });
  await connectDB();
  const url = new URL(req.url);
  const { page, limit, skip } = parsePaging(url, 25);
  const p = url.searchParams;

  const filter: Record<string, unknown> = {};
  const actor = p.get("actor");
  if (actor && isObjectId(actor)) filter.actor = new Types.ObjectId(actor);
  const mod = p.get("module");
  if (mod) filter.module = mod;
  const action = p.get("action");
  if (action && (ACTIONS as readonly string[]).includes(action)) filter.action = action;
  const entity = p.get("entity");
  if (entity) filter.entityId = entity;

  const range: Record<string, Date> = {};
  const from = p.get("from");
  const to = p.get("to");
  if (from && !Number.isNaN(Date.parse(from))) range.$gte = new Date(`${from}T00:00:00`);
  if (to && !Number.isNaN(Date.parse(to))) range.$lte = new Date(`${to}T23:59:59.999`);
  if (Object.keys(range).length) filter.createdAt = range;

  const q = p.get("search")?.trim();
  if (q) {
    const rx = new RegExp(escapeRegex(q.slice(0, 100)), "i");
    filter.$or = [{ summary: rx }, { entityLabel: rx }, { actorName: rx }, { actorEmail: rx }];
  }

  const [docs, total] = await Promise.all([
    ActivityLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    ActivityLog.countDocuments(filter),
  ]);

  const items = docs.map((d) => ({
    id: String(d._id),
    createdAt: d.createdAt ? new Date(d.createdAt).toISOString() : null,
    actorId: d.actor ? String(d.actor) : null,
    actorName: d.actorName ?? null,
    actorEmail: d.actorEmail ?? null,
    actorRole: d.actorRole ?? null,
    action: d.action,
    module: d.module,
    resource: d.resource ?? null,
    entityId: d.entityId ?? null,
    entityLabel: d.entityLabel ?? null,
    summary: d.summary,
    changedFields: d.changedFields ?? [],
    ip: d.ip ?? null,
  }));
  return ok(items, { pagination: pagination(page, limit, total) });
});
