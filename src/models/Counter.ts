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
