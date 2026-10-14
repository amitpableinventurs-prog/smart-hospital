import { handle, ok, readJson } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { docAction } from "@/lib/inventory";
import { requireUser } from "@/lib/session";

type Ctx = { params: Promise<{ id: string }> };

/** { action: "approve" | "reject" | "close" | "cancel" | "release" | "count" | "post", reason?, counts?, confirmUncounted? } */
export const POST = handle<Ctx>(async (req, { params }) => {
  const user = await requireUser({ module: "inventory" });
  const { id } = await params;
  const body = await readJson(req);
  await connectDB();
  return ok(await docAction(id, body, user, req));
});
