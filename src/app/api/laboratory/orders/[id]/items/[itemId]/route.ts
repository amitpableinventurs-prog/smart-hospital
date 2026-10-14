import { handle, ok, readJson } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { itemAction } from "@/lib/laboratory";
import { requireUser } from "@/lib/session";

type Ctx = { params: Promise<{ id: string; itemId: string }> };

/**
 * { action: "process" | "sendout" | "results" | "verify" | "approve" | "reopen" | "cancel", ... }
 * results: { results: [{ key, value }], reportText?, remarks? } · sendout: { lab?, reference? }
 * approve: { pathologist } · reopen / cancel: { reason }
 */
export const POST = handle<Ctx>(async (req, { params }) => {
  const user = await requireUser({ module: "laboratory" });
  const { id, itemId } = await params;
  const body = await readJson(req);
  await connectDB();
  return ok(await itemAction(id, itemId, body, user, req));
});
