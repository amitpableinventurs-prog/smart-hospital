import { handle, ok } from "@/lib/api";
import { getShift } from "@/lib/billing";
import { connectDB } from "@/lib/db";
import { requireUser } from "@/lib/session";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle<Ctx>(async (_req, { params }) => {
  await requireUser({ module: "billing" });
  const { id } = await params;
  await connectDB();
  return ok(await getShift(id));
});
