import { handle, ok, readJson } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { deleteSales, updateSales } from "@/lib/sales";
import { requireUser } from "@/lib/session";

type Ctx = { params: Promise<{ resource: string; id: string }> };

export const PATCH = handle<Ctx>(async (req, { params }) => {
  const user = await requireUser({ superAdmin: true });
  const body = await readJson(req);
  await connectDB();
  const { resource, id } = await params;
  return ok(await updateSales(resource, id, body, user, req));
});

export const DELETE = handle<Ctx>(async (req, { params }) => {
  const user = await requireUser({ superAdmin: true });
  await connectDB();
  const { resource, id } = await params;
  return ok(await deleteSales(resource, id, user, req));
});
