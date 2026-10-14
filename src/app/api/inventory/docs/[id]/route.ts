import { handle, ok } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { getDoc } from "@/lib/inventory";
import { requireUser } from "@/lib/session";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle<Ctx>(async (_req, { params }) => {
  await requireUser({ module: "inventory" });
  const { id } = await params;
  await connectDB();
  return ok(await getDoc(id));
});
