import { handle, ok } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { listPayments } from "@/lib/subscriptions";

/** Licence payments: ?client=&status=&method=&channel=&partner=&from=&to=&search=&page= → { rows, totals } */
export const GET = handle(async (req) => {
  await requireUser({ superAdmin: true });
  await connectDB();
  const { rows, totals, pagination } = await listPayments(new URL(req.url));
  return ok({ rows, totals }, { pagination });
});
