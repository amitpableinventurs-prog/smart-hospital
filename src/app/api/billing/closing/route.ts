import { handle, ok, readJson } from "@/lib/api";
import { closeDay, dayClosing } from "@/lib/billing";
import { connectDB } from "@/lib/db";
import { requireUser } from "@/lib/session";

/** Collections of one day by mode, cashier and department: ?date=YYYY-MM-DD */
export const GET = handle(async (req) => {
  await requireUser({ module: "billing" });
  await connectDB();
  return ok(await dayClosing(new URL(req.url)));
});

/** Close the day's cash: { date?, cashDeposited?, depositReference?, notes? } */
export const POST = handle(async (req) => {
  const user = await requireUser({ module: "billing" });
  const body = await readJson(req);
  await connectDB();
  return ok(await closeDay(body, user, req));
});
