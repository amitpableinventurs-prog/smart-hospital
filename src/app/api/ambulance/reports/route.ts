import { handle, ok } from "@/lib/api";
import { ambulanceReports } from "@/lib/ambulance";
import { connectDB } from "@/lib/db";
import { requireUser } from "@/lib/session";

/** GET /api/ambulance/reports?from=2026-10-01&to=2026-10-31 */
export const GET = handle(async (req) => {
  await requireUser({ module: "ambulance" });
  await connectDB();
  return ok(await ambulanceReports(new URL(req.url)));
});
