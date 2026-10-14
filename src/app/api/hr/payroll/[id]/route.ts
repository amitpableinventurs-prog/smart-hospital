import { handle, ok } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { deletePayroll, getPayroll } from "@/lib/hr";
import { requireUser } from "@/lib/session";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle<Ctx>(async (_req, { params }) => {
  await requireUser({ module: "hr" });
  const { id } = await params;
  await connectDB();
  return ok(await getPayroll(id));
});

/** Only drafts can be deleted. */
export const DELETE = handle<Ctx>(async (req, { params }) => {
  const user = await requireUser({ module: "hr" });
  const { id } = await params;
  await connectDB();
  return ok(await deletePayroll(id, user, req));
});
