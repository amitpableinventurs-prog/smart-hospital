import { handle, ok, readJson } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { addPayment } from "@/lib/laboratory";
import { requireUser } from "@/lib/session";

type Ctx = { params: Promise<{ id: string }> };

/** Record a payment or refund: { kind: "Payment" | "Refund", amount, mode, reference? } */
export const POST = handle<Ctx>(async (req, { params }) => {
  const user = await requireUser({ module: "laboratory" });
  const { id } = await params;
  const body = await readJson(req);
  await connectDB();
  return ok(await addPayment(id, body, user, req));
});
