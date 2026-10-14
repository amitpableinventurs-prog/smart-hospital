import { handle, ok, readJson } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { cancelOrder } from "@/lib/laboratory";
import { requireUser } from "@/lib/session";

type Ctx = { params: Promise<{ id: string }> };

/** Cancel the whole order: { reason } */
export const POST = handle<Ctx>(async (req, { params }) => {
  const user = await requireUser({ module: "laboratory" });
  const { id } = await params;
  const body = await readJson(req);
  await connectDB();
  return ok(await cancelOrder(id, String(body.reason ?? ""), user, req));
});
