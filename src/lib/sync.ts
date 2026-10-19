import "server-only";
import { createHash } from "node:crypto";
import type { Collection } from "mongodb";
import mongoose from "mongoose";
import { connectDB } from "./db";
import { controlUrl } from "./deployment";
import { LOCAL_ONLY_COLLECTIONS, Licence, SyncState } from "@/models/licence";

/**
 * One-way upload of a client installation's data to the Control Panel, which
 * keeps it in a database of its own for that client. Each collection is
 * uploaded in one of three ways, chosen from its documents:
 *   updatedAt — one full pass, then documents changed since the last upload
 *   id        — append-only collections (e.g. the activity log): new documents
 *   full      — small collections without timestamps (counters): the whole
 *               collection, whenever its content changes
 * Deleted documents are found every few hours by comparing ids.
 */

type Raw = Record<string, unknown> & { _id: unknown };
type Db = NonNullable<typeof mongoose.connection.db>;

const BATCH_DOCS = 500;
const BATCH_BYTES = 2_000_000;
const ID_CHUNK = 5000;
const RECONCILE_EVERY_MS = 6 * 3_600_000;
const TIMEOUT_MS = 60_000;
/** Never leave the installation: password hashes and encrypted payment keys. */
const STRIP_FIELDS = ["passwordHash", "secretEnc"];

const EJSON = () => mongoose.mongo.BSON.EJSON;
const ser = (v: unknown) => EJSON().stringify(v, { relaxed: false });

export interface SyncSummary {
  skipped?: string;
  collections: number;
  sent: number;
  errors: string[];
  at: string;
}

let running: Promise<SyncSummary> | null = null;

/** Upload what changed. Concurrent calls share one run. */
export function runSync() {
  running ??= doSync().finally(() => {
    running = null;
  });
  return running;
}

/** Forget all checkpoints so the next run uploads everything again. */
export async function resetSync() {
  await connectDB();
  await SyncState.deleteMany({});
}

async function post(token: string, body: Record<string, unknown>) {
  let res: Response;
  try {
    res = await fetch(`${controlUrl()}/api/control/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    throw new Error("Cannot reach the licence server");
  }
  const json = (await res.json().catch(() => null)) as { success?: boolean; data?: Record<string, unknown>; error?: { message?: string } } | null;
  if (!res.ok || !json?.success) throw new Error(json?.error?.message ?? `Upload failed (HTTP ${res.status})`);
  return json.data ?? {};
}

function strip(doc: Raw) {
  const out = { ...doc };
  for (const f of STRIP_FIELDS) delete out[f];
  return out;
}

/** Splits documents into uploads of at most BATCH_BYTES of EJSON. */
function* chunks(docs: Raw[]) {
  let parts: string[] = [];
  let size = 0;
  for (const d of docs) {
    const s = ser(strip(d));
    if (parts.length && size + s.length > BATCH_BYTES) {
      yield `[${parts.join(",")}]`;
      parts = [];
      size = 0;
    }
    parts.push(s);
    size += s.length;
  }
  if (parts.length) yield `[${parts.join(",")}]`;
}

async function doSync(): Promise<SyncSummary> {
  const at = new Date().toISOString();
  await connectDB();
  const lic = await Licence.findById("licence").select("+installToken").lean();
  if (!lic) return { skipped: "Not activated", collections: 0, sent: 0, errors: [], at };
  if (lic.status === "Deactivated") return { skipped: "Installation deactivated", collections: 0, sent: 0, errors: [], at };
  if (!lic.syncEnabled) return { skipped: "Upload is turned off by the vendor", collections: 0, sent: 0, errors: [], at };
  const db = mongoose.connection.db!;
  const names = (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name).filter((n) => !n.startsWith("system.") && !LOCAL_ONLY_COLLECTIONS.includes(n)).sort();

  const summary: SyncSummary = { collections: 0, sent: 0, errors: [], at };
  for (const name of names) {
    try {
      summary.sent += await syncCollection(db, name, lic.installToken);
      summary.collections++;
    } catch (err) {
      const message = (err as Error).message;
      summary.errors.push(`${name}: ${message}`);
      await SyncState.updateOne({ _id: name }, { $set: { error: message } });
      // Offline: the remaining collections would fail the same way.
      if (/Cannot reach/.test(message)) break;
    }
  }
  return summary;
}

async function syncCollection(db: Db, name: string, token: string) {
  const coll = db.collection<Raw>(name);
  let state = await SyncState.findById(name);
  if (!state) {
    const sample = await coll.findOne({}, { sort: { _id: -1 } });
    if (!sample) return 0;
    const mode = sample.updatedAt instanceof Date ? "updatedAt" : (sample._id as object) instanceof mongoose.mongo.ObjectId ? "id" : "full";
    state = new SyncState({ _id: name, mode, ...(mode === "updatedAt" ? { initialFrom: new Date(Date.now() - 1000) } : {}) });
  }
  const now = new Date();
  let sent = 0;

  if (state.mode === "full") {
    const docs = await coll.find({}).sort({ _id: 1 }).toArray();
    const hash = createHash("sha1").update(ser(docs.map(strip))).digest("hex");
    if (hash !== state.lastHash) {
      let first = true;
      for (const batch of chunks(docs)) {
        await post(token, { collection: name, action: first ? "replace" : "upsert", docs: batch });
        first = false;
      }
      if (first) await post(token, { collection: name, action: "replace", docs: "[]" });
      state.lastHash = hash;
      sent = docs.length;
    }
  } else {
    for (;;) {
      // updatedAt mode starts with a pass over every document by _id, then follows updatedAt.
      const initial = state.mode === "updatedAt" && !state.lastUpdatedAt;
      const filter: Record<string, unknown> =
        state.mode === "updatedAt" && !initial
          ? state.lastId != null
            ? { $or: [{ updatedAt: { $gt: state.lastUpdatedAt } }, { updatedAt: state.lastUpdatedAt, _id: { $gt: state.lastId } }] }
            : { updatedAt: { $gte: state.lastUpdatedAt } }
          : state.lastId != null
            ? { _id: { $gt: state.lastId } }
            : {};
      const sort: Record<string, 1> = state.mode === "updatedAt" && !initial ? { updatedAt: 1, _id: 1 } : { _id: 1 };
      const docs = await coll.find(filter).sort(sort).limit(BATCH_DOCS).toArray();
      for (const batch of chunks(docs)) await post(token, { collection: name, action: "upsert", docs: batch });
      sent += docs.length;
      const last = docs[docs.length - 1];
      if (last) {
        state.lastId = last._id;
        if (!initial && last.updatedAt instanceof Date) state.lastUpdatedAt = last.updatedAt;
      }
      const done = docs.length < BATCH_DOCS;
      if (initial && done) {
        // Changes made while the first pass ran have a later updatedAt and are sent next time.
        state.lastUpdatedAt = state.initialFrom ?? now;
        state.lastId = null;
      }
      state.markModified("lastId");
      await state.save();
      if (done) break;
    }
    if (!state.lastReconcileAt || now.getTime() - state.lastReconcileAt.getTime() > RECONCILE_EVERY_MS) {
      await reconcile(coll, name, token);
      state.lastReconcileAt = now;
    }
  }
  state.lastSyncAt = now;
  state.sent = (state.sent ?? 0) + sent;
  state.error = undefined;
  await state.save();
  return sent;
}

/** Removes documents from the central copy that were deleted here. */
async function reconcile(coll: Collection<Raw>, name: string, token: string) {
  const local = await coll.countDocuments();
  const { count } = (await post(token, { collection: name, action: "count" })) as { count?: number };
  if (count === local) return;
  let from: unknown = null;
  for (;;) {
    const ids = (await coll.find(from === null ? {} : { _id: { $gt: from as never } }, { projection: { _id: 1 } }).sort({ _id: 1 }).limit(ID_CHUNK).toArray()).map((d) => d._id);
    const to = ids.length === ID_CHUNK ? ids[ids.length - 1] : null;
    await post(token, { collection: name, action: "reconcile", ids: ser(ids), from: ser(from), to: ser(to) });
    if (to === null) break;
    from = to;
  }
}

/** Per-collection upload state for the Licence & Sync screen. */
export async function syncStatus() {
  await connectDB();
  const rows = await SyncState.find().sort({ _id: 1 }).lean();
  return rows.map((s) => ({ collection: s._id, mode: s.mode, lastSyncAt: s.lastSyncAt?.toISOString() ?? null, sent: s.sent ?? 0, error: s.error ?? null }));
}
