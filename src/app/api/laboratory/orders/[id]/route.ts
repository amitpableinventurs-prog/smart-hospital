import { handle, ok } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { getOrder } from "@/lib/laboratory";
import { requireUser } from "@/lib/session";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle<Ctx>(async (_req, { params }) => {
  await requireUser({ module: "laboratory" });
  const { id } = await params;
  await connectDB();
  return ok(await getOrder(id));
});
