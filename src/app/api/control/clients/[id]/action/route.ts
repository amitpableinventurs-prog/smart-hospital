import { handle, ok, readJson } from "@/lib/api";
import { clientAction } from "@/lib/control";
import { connectDB } from "@/lib/db";
import { requireUser } from "@/lib/session";

type Ctx = { params: Promise<{ id: string }> };

/** { action: "regenerate-key" | "reset-installation" | "resync" | "check-dns" } */
export const POST = handle<Ctx>(async (req, { params }) => {
  const user = await requireUser({ superAdmin: true });
  const body = await readJson(req);
  await connectDB();
  return ok(await clientAction((await params).id, body, user, req));
});
