import { handle, ok, readJson } from "@/lib/api";
import { listRecon, reconcile } from "@/lib/billing";
import { connectDB } from "@/lib/db";
import { requireUser } from "@/lib/session";

/** Non-cash payments to reconcile: ?status=Pending|Reconciled|Bounced&mode=&from=&to=&page= */
export const GET = handle(async (req) => {
  await requireUser({ module: "billing" });
  await connectDB();
  const { items, pagination, total } = await listRecon(new URL(req.url));
  return ok({ items, total }, { pagination });
});

/** { bill, receipt, split, status: "Reconciled" | "Bounced" | "Pending", note? } */
export const POST = handle(async (req) => {
  const user = await requireUser({ module: "billing" });
  const body = await readJson(req);
  await connectDB();
  return ok(await reconcile(body, user, req));
});
