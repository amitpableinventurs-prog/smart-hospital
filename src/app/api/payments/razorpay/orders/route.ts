import { handle, ok, readJson } from "@/lib/api";
import { createOrder } from "@/lib/payments";
import { requireUser } from "@/lib/session";

/** { kind: "lab_order" | "pharmacy_sale" | "ambulance_trip", id, amount } → checkout options. */
export const POST = handle(async (req) => {
  const user = await requireUser();
  return ok(await createOrder(await readJson(req), user), { status: 201 });
});
