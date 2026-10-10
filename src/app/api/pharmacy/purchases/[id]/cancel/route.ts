import { handle, ok, readJson } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { cancelPurchase, serializePurchase } from "@/lib/pharmacy";
import { requireUser } from "@/lib/session";

type Ctx = { params: Promise<{ id: string }> };

/** Reverse a purchase entry (only if its stock is still on hand): { reason } */
export const POST = handle<Ctx>(async (req, { params }) => {
  const user = await requireUser({ module: "pharmacy" });
  const { id } = await params;
  const body = await readJson(req);
  await connectDB();
  const purchase = await cancelPurchase(id, String(body.reason ?? ""), user, req);
  return ok(serializePurchase(purchase!));
});
