import { handle, ok, readJson } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { createSale, listSales, serializeSale } from "@/lib/pharmacy";
import { requireUser } from "@/lib/session";

/** GET /api/pharmacy/sales?search=&from=2026-10-01&to=2026-10-10&status=Unpaid&patient=<id>&page=1 */
export const GET = handle(async (req) => {
  await requireUser({ module: "pharmacy" });
  await connectDB();
  const { items, pagination } = await listSales(new URL(req.url));
  return ok(items, { pagination });
});

export const POST = handle(async (req) => {
  const user = await requireUser({ module: "pharmacy" });
  const body = await readJson(req);
  await connectDB();
  return ok(serializeSale(await createSale(body, user, req)), { status: 201 });
});
