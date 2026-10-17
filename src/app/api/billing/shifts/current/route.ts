import { handle, ok } from "@/lib/api";
import { myShift } from "@/lib/billing";
import { connectDB } from "@/lib/db";
import { requireUser } from "@/lib/session";

/** The signed-in cashier's open shift with live totals, or null. */
export const GET = handle(async () => {
  const user = await requireUser({ module: "billing" });
  await connectDB();
  return ok(await myShift(user));
});
