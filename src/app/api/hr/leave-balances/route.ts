import { handle, ok } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { leaveBalances } from "@/lib/hr";
import { requireUser } from "@/lib/session";

/** GET /api/hr/leave-balances?year=2026&department=&search= */
export const GET = handle(async (req) => {
  await requireUser({ module: "hr" });
  await connectDB();
  return ok(await leaveBalances(new URL(req.url)));
});
