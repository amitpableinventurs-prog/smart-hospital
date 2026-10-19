import { handle, ok, readJson } from "@/lib/api";
import { heartbeat } from "@/lib/control";
import { connectDB } from "@/lib/db";

/** An installation checking in (Authorization: Bearer <install token>): { version, host, stats } → its licence. */
export const POST = handle(async (req) => {
  const body = await readJson(req);
  await connectDB();
  return ok(await heartbeat(body, req));
});
