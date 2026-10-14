import { handle, ok } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { analytics } from "@/lib/laboratory";
import { requireUser } from "@/lib/session";

/** GET /api/laboratory/analytics?from=2026-10-01&to=2026-10-31 */
export const GET = handle(async (req) => {
  await requireUser({ module: "laboratory" });
  await connectDB();
  return ok(await analytics(new URL(req.url)));
});
