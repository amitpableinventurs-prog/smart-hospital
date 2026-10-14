import { handle, ok, readJson } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { preauthAction } from "@/lib/insurance";
import { requireUser } from "@/lib/session";

type Ctx = { params: Promise<{ id: string }> };

/** { action: "submit" | "update" | "query" | "respond" | "approve" | "reject" | "enhance" | "decide-enhancement" | "link-admission" | "sync-bill" | "cancel", … } */
export const POST = handle<Ctx>(async (req, { params }) => {
  const user = await requireUser({ module: "insurance" });
  const { id } = await params;
  const body = await readJson(req);
  await connectDB();
  return ok(await preauthAction(id, body, user, req));
});
