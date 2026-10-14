import "server-only";
import mongoose, { Schema, type Model } from "mongoose";

interface CounterDoc {
  _id: string;
  seq: number;
}

const CounterSchema = new Schema<CounterDoc>({ _id: String, seq: { type: Number, default: 0 } }, { versionKey: false });

const Counter: Model<CounterDoc> = mongoose.models.Counter ?? mongoose.model<CounterDoc>("Counter", CounterSchema);

/** Atomically allocate the next human-readable code, e.g. "INV-2026-000042". */
export async function nextCode(prefix: string): Promise<string> {
  const year = new Date().getFullYear();
  const key = `${prefix}-${year}`;
  const doc = await Counter.findOneAndUpdate({ _id: key }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: "after" });
  return `${key}-${String(doc!.seq).padStart(6, "0")}`;
}

/**
 * All-digit sample accession number, e.g. "2600000042" (year + sequence).
 * Digits only so the Code 128 barcode stays short enough for small tube labels.
 */
export async function nextAccession(): Promise<string> {
  const year = new Date().getFullYear();
  const doc = await Counter.findOneAndUpdate({ _id: `ACC-${year}` }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: "after" });
  return `${String(year).slice(2)}${String(doc!.seq).padStart(8, "0")}`;
}

/** Plain incrementing number for a key, e.g. per-category SKU serials. */
export async function nextSerial(key: string): Promise<number> {
  const doc = await Counter.findOneAndUpdate({ _id: key }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: "after" });
  return doc!.seq;
}
