import { handle, ok, readJson } from "@/lib/api";
import { reopenDay } from "@/lib/billing";
import { connectDB } from "@/lib/db";
import { requireUser } from "@/lib/session";

/** Super admin only: { date, reason } */
export const POST = handle(async (req) => {
  const user = await requireUser({ module: "billing", superAdmin: true });
  const body = await readJson(req);
  await connectDB();
  return ok(await reopenDay(body, user, req));
});
