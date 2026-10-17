import { handle, ok, readJson } from "@/lib/api";
import { closeShift } from "@/lib/billing";
import { connectDB } from "@/lib/db";
import { requireUser } from "@/lib/session";

type Ctx = { params: Promise<{ id: string }> };

/** { countedCash, notes?, handoverTo? } — notes are required when the cash is over or short. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const user = await requireUser({ module: "billing" });
  const { id } = await params;
  const body = await readJson(req);
  await connectDB();
  return ok(await closeShift(id, body, user, req));
});
