import { cancelVoucher } from "@/lib/accounts";
import { handle, ok, readJson } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { requireUser } from "@/lib/session";

type Ctx = { params: Promise<{ id: string }> };

/** { reason } — manual vouchers only. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const user = await requireUser({ module: "accounts" });
  const { id } = await params;
  const body = await readJson(req);
  await connectDB();
  return ok(await cancelVoucher(id, String(body.reason ?? ""), user, req));
});
