import { handle, ok } from "@/lib/api";
import { listReceipts } from "@/lib/billing";
import { connectDB } from "@/lib/db";
import { requireUser } from "@/lib/session";

/** Receipt register: ?kind=&mode=&shift=&search=&from=&to=&page= */
export const GET = handle(async (req) => {
  await requireUser({ module: "billing" });
  await connectDB();
  const { items, pagination, totals } = await listReceipts(new URL(req.url));
  return ok({ items, totals }, { pagination });
});
