import { handle, ok, readJson } from "@/lib/api";
import { createBill, getBill, listBills } from "@/lib/billing";
import { connectDB } from "@/lib/db";
import { requireUser } from "@/lib/session";

/** GET /api/billing/bills?search=&status=&billType=&paymentStatus=&payerType=&patient=&due=1&from=&to=&page= */
export const GET = handle(async (req) => {
  await requireUser({ module: "billing" });
  await connectDB();
  const { items, pagination } = await listBills(new URL(req.url));
  return ok(items, { pagination });
});

/**
 * Open a bill: { patient, billType, visit?, admission?, doctor?, payerType?, …payer, ratePlan?, lines[], discount?, discountReason?,
 * finalize?, discharge?, payment?: { kind, splits[] } }
 */
export const POST = handle(async (req) => {
  const user = await requireUser({ module: "billing" });
  const body = await readJson(req);
  await connectDB();
  const bill = await createBill(body, user, req);
  return ok(await getBill(String(bill._id)), { status: 201 });
});
