import { handle, ok, readJson } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { recordPayment } from "@/lib/subscriptions";

type Ctx = { params: Promise<{ id: string }> };

/** Record a payment received outside the app: { plan, method, reference?, paidOn?, coupon?, extraDiscount?, periodTo?, notes? } → extends the licence; { payment, offlineKey }. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const user = await requireUser({ superAdmin: true });
  const body = await readJson(req);
  await connectDB();
  return ok(await recordPayment((await params).id, body, user, req), { status: 201 });
});
