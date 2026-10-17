import { handle, ok, readJson } from "@/lib/api";
import { billAction } from "@/lib/billing";
import { connectDB } from "@/lib/db";
import { requireUser } from "@/lib/session";

type Ctx = { params: Promise<{ id: string }> };

/** { action: "add-lines" | "update-line" | "cancel-line" | "receipt" | "finalize" | "reopen" | "cancel", … } */
export const POST = handle<Ctx>(async (req, { params }) => {
  const user = await requireUser({ module: "billing" });
  const { id } = await params;
  const body = await readJson(req);
  await connectDB();
  return ok(await billAction(id, body, user, req));
});
