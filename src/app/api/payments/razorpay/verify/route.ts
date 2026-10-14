import { handle, ok, readJson } from "@/lib/api";
import { verifyPayment } from "@/lib/payments";
import { requireUser } from "@/lib/session";

/** Checkout success: { txnId, razorpay_order_id, razorpay_payment_id, razorpay_signature }. */
export const POST = handle(async (req) => {
  const user = await requireUser();
  return ok(await verifyPayment(await readJson(req), user, req));
});
