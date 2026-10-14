import { handle, ok, readJson } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { sampleAction } from "@/lib/laboratory";
import { requireUser } from "@/lib/session";

type Ctx = { params: Promise<{ id: string; sampleId: string }> };

/** { action: "collect" | "receive" | "reject", reason?, note? } */
export const POST = handle<Ctx>(async (req, { params }) => {
  const user = await requireUser({ module: "laboratory" });
  const { id, sampleId } = await params;
  const body = await readJson(req);
  await connectDB();
  return ok(await sampleAction(id, sampleId, body, user, req));
});
