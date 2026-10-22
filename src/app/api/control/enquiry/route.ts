import { handle, ok, readJson } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { createEnquiry } from "@/lib/subscriptions";

/** "Request a demo" from the pricing page: becomes a lead. Rate-limited. */
export const POST = handle(async (req) => {
  const body = await readJson(req);
  await connectDB();
  return ok(await createEnquiry(body, req), { status: 201 });
});
