import "server-only";
import mongoose from "mongoose";

declare global {
  var __mongoose: { conn: typeof mongoose | null; promise: Promise<typeof mongoose> | null } | undefined;
}

const cache = (globalThis.__mongoose ??= { conn: null, promise: null });

/** Connect once per server process; reused across hot reloads and requests. */
export async function connectDB(): Promise<typeof mongoose> {
  if (cache.conn) return cache.conn;

  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set. Add it to .env.local.");

  cache.promise ??= mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 }).catch((err) => {
    cache.promise = null;
    throw err;
  });
  cache.conn = await cache.promise;
  return cache.conn;
}
