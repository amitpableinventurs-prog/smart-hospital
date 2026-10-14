import { handle, ok } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { insuranceReports } from "@/lib/insurance";
import { requireUser } from "@/lib/session";

/** GET /api/insurance/reports?from=2026-10-01&to=2026-10-31 */
export const GET = handle(async (req) => {
  await requireUser({ module: "insurance" });
  await connectDB();
  return ok(await insuranceReports(new URL(req.url)));
});
