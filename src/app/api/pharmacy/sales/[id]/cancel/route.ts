import { handle, ok, readJson } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { cancelSale, serializeSale } from "@/lib/pharmacy";
import { requireUser } from "@/lib/session";

type Ctx = { params: Promise<{ id: string }> };

/** Cancel a bill and return its stock: { reason } */
export const POST = handle<Ctx>(async (req, { params }) => {
  const user = await requireUser({ module: "pharmacy" });
  const { id } = await params;
  const body = await readJson(req);
  await connectDB();
  const sale = await cancelSale(id, String(body.reason ?? ""), user, req);
  return ok(serializeSale(sale!));
});
