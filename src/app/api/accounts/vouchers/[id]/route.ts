import { getVoucher, updateVoucher } from "@/lib/accounts";
import { handle, ok, readJson } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { requireUser } from "@/lib/session";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle<Ctx>(async (_req, { params }) => {
  await requireUser({ module: "accounts" });
  const { id } = await params;
  await connectDB();
  return ok(await getVoucher(id));
});

/** Edit a manual voucher: { date, narration?, refNo?, entries } (the type stays). */
export const PUT = handle<Ctx>(async (req, { params }) => {
  const user = await requireUser({ module: "accounts" });
  const { id } = await params;
  const body = await readJson(req);
  await connectDB();
  return ok(await updateVoucher(id, body, user, req));
});
