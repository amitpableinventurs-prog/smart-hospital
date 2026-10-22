import { handle, ok, readJson } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { createPlan, listPlans } from "@/lib/subscriptions";

/** Control Panel: subscription plans with the number of clients on each. */
export const GET = handle(async () => {
  await requireUser({ superAdmin: true });
  await connectDB();
  return ok(await listPlans());
});

/** { code, name, modules[], durationDays, price, gstPct, graceDays, maxUsers, trial, public, active, features[], description, sortOrder } */
export const POST = handle(async (req) => {
  const user = await requireUser({ superAdmin: true });
  const body = await readJson(req);
  await connectDB();
  return ok(await createPlan(body, user, req), { status: 201 });
});
