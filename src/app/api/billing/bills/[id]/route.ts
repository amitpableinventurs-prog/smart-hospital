import { handle, ok, readJson } from "@/lib/api";
import { getBill, updateBill } from "@/lib/billing";
import { connectDB } from "@/lib/db";
import { requireUser } from "@/lib/session";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle<Ctx>(async (_req, { params }) => {
  await requireUser({ module: "billing" });
  const { id } = await params;
  await connectDB();
  return ok(await getBill(id));
});

/** Header changes: { notes?, doctor?, department?, payerType?, …payer, ratePlan?, discount?, discountReason?, discountApprovedBy? } */
export const PATCH = handle<Ctx>(async (req, { params }) => {
  const user = await requireUser({ module: "billing" });
  const { id } = await params;
  const body = await readJson(req);
  await connectDB();
  return ok(await updateBill(id, body, user, req));
});
