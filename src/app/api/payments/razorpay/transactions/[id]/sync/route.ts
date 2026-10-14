import { handle, ok } from "@/lib/api";
import { syncTxn } from "@/lib/payments";
import { requireUser } from "@/lib/session";

type Ctx = { params: Promise<{ id: string }> };

/** Re-check the order with Razorpay and record the payment if it was captured. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const user = await requireUser();
  return ok(await syncTxn((await params).id, user, req));
});
