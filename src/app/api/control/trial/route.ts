import { handle, ok, readJson } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { startTrial } from "@/lib/subscriptions";

/** A new installation's setup screen starting the free trial (no licence key): hospital and contact details + installationId. Rate-limited. */
export const POST = handle(async (req) => {
  const body = await readJson(req);
  await connectDB();
  return ok(await startTrial(body, req), { status: 201 });
});
