import { ApiError, handle, ok } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { serializePurchase } from "@/lib/pharmacy";
import { requireUser } from "@/lib/session";
import { isObjectId } from "@/lib/validation";
import { Purchase } from "@/models/pharmacy";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle<Ctx>(async (_req, { params }) => {
  await requireUser({ module: "pharmacy" });
  const { id } = await params;
  if (!isObjectId(id)) throw new ApiError(404, "Purchase not found");
  await connectDB();
  const purchase = await Purchase.findById(id).lean();
  if (!purchase) throw new ApiError(404, "Purchase not found");
  return ok(serializePurchase(purchase));
});
