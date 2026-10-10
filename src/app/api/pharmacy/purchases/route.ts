import { handle, ok, readJson } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { createPurchase, listPurchases, serializePurchase } from "@/lib/pharmacy";
import { requireUser } from "@/lib/session";

/** GET /api/pharmacy/purchases?search=&from=&to=&status=&page=1 */
export const GET = handle(async (req) => {
  await requireUser({ module: "pharmacy" });
  await connectDB();
  const { items, pagination } = await listPurchases(new URL(req.url));
  return ok(items, { pagination });
});

export const POST = handle(async (req) => {
  const user = await requireUser({ module: "pharmacy" });
  const body = await readJson(req);
  await connectDB();
  return ok(serializePurchase(await createPurchase(body, user, req)), { status: 201 });
});
