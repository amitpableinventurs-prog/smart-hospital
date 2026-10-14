import { handle, ok } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { hrReports } from "@/lib/hr";
import { requireUser } from "@/lib/session";

/** GET /api/hr/reports?from=2026-10-01&to=2026-10-31 */
export const GET = handle(async (req) => {
  await requireUser({ module: "hr" });
  await connectDB();
  return ok(await hrReports(new URL(req.url)));
});
