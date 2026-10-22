import { repostAll, runPosting } from "@/lib/accounts";
import { handle, ok, readJson } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { requireUser } from "@/lib/session";

/** Post what changed in the other modules; { full: true } rebuilds every automatic voucher. */
export const POST = handle(async (req) => {
  const user = await requireUser({ module: "accounts" });
  const body = await readJson(req);
  await connectDB();
  return ok(body.full === true ? await repostAll(user, req) : await runPosting());
});
