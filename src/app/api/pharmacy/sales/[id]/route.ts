import { ApiError, handle, ok, readJson } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { receivePayment, serializeSale, storeInfo } from "@/lib/pharmacy";
import { requireUser } from "@/lib/session";
import { isObjectId } from "@/lib/validation";
import { Sale } from "@/models/pharmacy";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle<Ctx>(async (_req, { params }) => {
  await requireUser({ module: "pharmacy" });
  const { id } = await params;
  if (!isObjectId(id)) throw new ApiError(404, "Bill not found");
  await connectDB();
  const sale = await Sale.findById(id).lean();
  if (!sale) throw new ApiError(404, "Bill not found");
  return ok({ ...serializeSale(sale), store: storeInfo() });
});

/** Receive a payment against a credit / partially paid bill: { amount, paymentMode } */
export const PATCH = handle<Ctx>(async (req, { params }) => {
  const user = await requireUser({ module: "pharmacy" });
  const { id } = await params;
  const body = await readJson(req);
  await connectDB();
  return ok(serializeSale(await receivePayment(id, body, user, req)));
});
