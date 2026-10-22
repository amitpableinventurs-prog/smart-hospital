import { handle, ok, readJson } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { createSales, listSales } from "@/lib/sales";
import { requireUser } from "@/lib/session";

type Ctx = { params: Promise<{ resource: string }> };

/** leads | partners | coupons: ?search=&page= plus filters (leads: status, source, due=1, open=1; partners / coupons: active). */
export const GET = handle<Ctx>(async (req, { params }) => {
  await requireUser({ superAdmin: true });
  await connectDB();
  const { rows, pagination } = await listSales((await params).resource, new URL(req.url));
  return ok(rows, { pagination });
});

export const POST = handle<Ctx>(async (req, { params }) => {
  const user = await requireUser({ superAdmin: true });
  const body = await readJson(req);
  await connectDB();
  return ok(await createSales((await params).resource, body, user, req), { status: 201 });
});
