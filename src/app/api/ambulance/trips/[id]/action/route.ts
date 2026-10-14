import { handle, ok, readJson } from "@/lib/api";
import { tripAction } from "@/lib/ambulance";
import { connectDB } from "@/lib/db";
import { requireUser } from "@/lib/session";

type Ctx = { params: Promise<{ id: string }> };

/** { action: "dispatch" | "on-scene" | "transport" | "arrive" | "complete" | "pay" | "update" | "cancel", … } */
export const POST = handle<Ctx>(async (req, { params }) => {
  const user = await requireUser({ module: "ambulance" });
  const { id } = await params;
  const body = await readJson(req);
  await connectDB();
  return ok(await tripAction(id, body, user, req));
});
