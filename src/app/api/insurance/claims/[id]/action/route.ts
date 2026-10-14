import { handle, ok, readJson } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { claimAction } from "@/lib/insurance";
import { requireUser } from "@/lib/session";

type Ctx = { params: Promise<{ id: string }> };

/** { action: "document" | "add-document" | "submit" | "review" | "query" | "respond" | "approve" | "settle" | "reject" | "cancel" | "note", … } */
export const POST = handle<Ctx>(async (req, { params }) => {
  const user = await requireUser({ module: "insurance" });
  const { id } = await params;
  const body = await readJson(req);
  await connectDB();
  return ok(await claimAction(id, body, user, req));
});
