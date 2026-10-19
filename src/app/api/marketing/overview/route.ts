import { handle, ok } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { marketingOverview } from "@/lib/marketing";
import { requireUser } from "@/lib/session";

/** GET /api/marketing/overview?from=&to= — funnel, sources, campaigns, referrals, follow-ups due and feedback scores. */
export const GET = handle(async (req) => {
  await requireUser({ module: "marketing" });
  await connectDB();
  return ok(await marketingOverview(new URL(req.url)));
});
