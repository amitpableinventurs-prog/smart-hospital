import { handle, ok, readJson } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { createPreauth, listPreauths } from "@/lib/insurance";
import { requireUser } from "@/lib/session";

/** GET /api/insurance/preauths?search=&status=&insurer=&page= */
export const GET = handle(async (req) => {
  await requireUser({ module: "insurance" });
  await connectDB();
  const { items, pagination } = await listPreauths(new URL(req.url));
  return ok(items, { pagination });
});

/** New cashless pre-authorisation; `submit: true` sends it at once. */
export const POST = handle(async (req) => {
  const user = await requireUser({ module: "insurance" });
  const body = await readJson(req);
  await connectDB();
  return ok(await createPreauth(body, user, req), { status: 201 });
});
