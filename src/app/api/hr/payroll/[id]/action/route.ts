import { handle, ok, readJson } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { payrollAction } from "@/lib/hr";
import { requireUser } from "@/lib/session";

type Ctx = { params: Promise<{ id: string }> };

/** { action: "adjust" | "finalise" | "reopen" | "pay", … } */
export const POST = handle<Ctx>(async (req, { params }) => {
  const user = await requireUser({ module: "hr" });
  const { id } = await params;
  const body = await readJson(req);
  await connectDB();
  return ok(await payrollAction(id, body, user, req));
});
