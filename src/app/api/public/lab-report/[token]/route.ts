import { handle, ok } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { sharedReport } from "@/lib/laboratory";

type Ctx = { params: Promise<{ token: string }> };

/** Public: approved results behind an unguessable, expiring, revocable share token. */
export const GET = handle<Ctx>(async (_req, { params }) => {
  const { token } = await params;
  await connectDB();
  return ok(await sharedReport(token));
});
