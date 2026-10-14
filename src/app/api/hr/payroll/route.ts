import { handle, ok, readJson } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { generatePayroll, listPayroll } from "@/lib/hr";
import { requireUser } from "@/lib/session";

export const GET = handle(async () => {
  await requireUser({ module: "hr" });
  await connectDB();
  return ok(await listPayroll());
});

/** Prepare (or regenerate) the month's draft: { month: "2026-10", unmarkedAsPresent?: boolean } */
export const POST = handle(async (req) => {
  const user = await requireUser({ module: "hr" });
  const body = await readJson(req);
  await connectDB();
  return ok(await generatePayroll(body, user, req), { status: 201 });
});
