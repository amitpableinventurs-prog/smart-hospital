import { handle, ok } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { salesOverview } from "@/lib/sales";
import { requireUser } from "@/lib/session";

/** Sales & marketing dashboard: ?from=&to= */
export const GET = handle(async (req) => {
  await requireUser({ superAdmin: true });
  await connectDB();
  return ok(await salesOverview(new URL(req.url)));
});
