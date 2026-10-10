import "server-only";
import mongoose from "mongoose";
import { NextResponse, connection } from "next/server";

/**
 * Response convention for every API route:
 *   success: { success: true, data, pagination? }
 *   failure: { success: false, error: { message, fields? } }
 */

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public fields?: Record<string, string>
  ) {
    super(message);
  }
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export function ok<T>(data: T, extra?: { pagination?: Pagination; status?: number }) {
  return NextResponse.json(
    { success: true, data, ...(extra?.pagination ? { pagination: extra.pagination } : {}) },
    { status: extra?.status ?? 200 }
  );
}

export function fail(status: number, message: string, fields?: Record<string, string>) {
  return NextResponse.json({ success: false, error: { message, ...(fields ? { fields } : {}) } }, { status });
}

type Handler<C> = (req: Request, ctx: C) => Promise<Response>;

/** Wraps a route handler with centralised error handling. */
export function handle<C>(fn: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    // API responses are per-user and must never be prerendered or cached.
    // Kept outside the try: during a build, Next.js signals "stop prerendering" by rejecting this.
    await connection();
    try {
      return await fn(req, ctx);
    } catch (err) {
      if (err instanceof ApiError) return fail(err.status, err.message, err.fields);
      if (err instanceof mongoose.Error.ValidationError) {
        const fields = Object.fromEntries(Object.entries(err.errors).map(([k, v]) => [k, v.message]));
        return fail(422, "Validation failed", fields);
      }
      if (err instanceof mongoose.Error.CastError) return fail(400, `Invalid value for ${err.path}`);
      if (typeof err === "object" && err && "code" in err && (err as { code: unknown }).code === 11000) {
        const key = Object.keys((err as { keyPattern?: object }).keyPattern ?? {})[0];
        return fail(409, key ? `A record with this ${key} already exists` : "Duplicate record");
      }
      if (err instanceof Error && /ECONNREFUSED|Server selection timed out|MONGODB_URI/.test(err.message)) {
        console.error("[api] database unavailable:", err.message);
        return fail(503, "Database is unavailable. Please try again shortly.");
      }
      console.error("[api] unhandled error:", err);
      return fail(500, "Something went wrong. Please try again.");
    }
  };
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body as Record<string, unknown>;
  } catch {
    throw new ApiError(400, "Request body must be a JSON object");
  }
}

export function parsePaging(url: URL, defaultLimit = 10) {
  const page = Math.max(1, Math.floor(Number(url.searchParams.get("page")) || 1));
  const limit = Math.min(100, Math.max(1, Math.floor(Number(url.searchParams.get("limit")) || defaultLimit)));
  return { page, limit, skip: (page - 1) * limit };
}

export function pagination(page: number, limit: number, total: number): Pagination {
  return { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) };
}

export function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function clientIp(req: Request) {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
}
