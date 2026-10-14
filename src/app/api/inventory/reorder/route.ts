import { handle, ok } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { reorderAlerts } from "@/lib/inventory";
import { requireUser } from "@/lib/session";

/** Items at or below their reorder / minimum level. */
export const GET = handle(async () => {
  await requireUser({ module: "inventory" });
  await connectDB();
  return ok(await reorderAlerts());
});
