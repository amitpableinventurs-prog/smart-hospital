import { handle, ok, readJson } from "@/lib/api";
import { listShifts, openShift } from "@/lib/billing";
import { connectDB } from "@/lib/db";
import { requireUser } from "@/lib/session";

/** GET /api/billing/shifts?status=&from=&to=&page= */
export const GET = handle(async (req) => {
  await requireUser({ module: "billing" });
  await connectDB();
  const { items, pagination } = await listShifts(new URL(req.url));
  return ok(items, { pagination });
});

/** Open the signed-in cashier's shift: { counter?, openingCash } */
export const POST = handle(async (req) => {
  const user = await requireUser({ module: "billing" });
  const body = await readJson(req);
  await connectDB();
  return ok(await openShift(body, user, req), { status: 201 });
});
