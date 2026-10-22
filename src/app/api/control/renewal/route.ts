import { handle, ok, readJson } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { renewal } from "@/lib/subscriptions";

/** A client installation renewing its plan (Authorization: Bearer <install token>): { action: info | order | verify | invoice, … }. */
export const POST = handle(async (req) => {
  const body = await readJson(req);
  await connectDB();
  return ok(await renewal(body, req));
});
