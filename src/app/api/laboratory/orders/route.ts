import { handle, ok, readJson } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { createOrder, getOrder, listOrders } from "@/lib/laboratory";
import { requireUser } from "@/lib/session";

/** GET /api/laboratory/orders?search=&status=&source=&priority=&paymentStatus=&from=&to=&patient=&page= */
export const GET = handle(async (req) => {
  await requireUser({ module: "laboratory" });
  await connectDB();
  const { items, pagination } = await listOrders(new URL(req.url));
  return ok(items, { pagination });
});

/** Lab registration / booking. */
export const POST = handle(async (req) => {
  const user = await requireUser({ module: "laboratory" });
  const body = await readJson(req);
  await connectDB();
  const order = await createOrder(body, user, req);
  return ok(await getOrder(String(order._id)), { status: 201 });
});
