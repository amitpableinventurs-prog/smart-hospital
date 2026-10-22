import { handle, ok, readJson } from "@/lib/api";
import { renewal } from "@/lib/licence";
import { requireUser } from "@/lib/session";

/** Super admin: plans, quote, Razorpay order and verification for renewing this hospital's plan (works while locked, from the lock screen). */
export const POST = handle(async (req) => {
  const user = await requireUser({ superAdmin: true, allowLocked: true });
  return ok(await renewal(await readJson(req), user, req));
});
