import { handle, ok } from "@/lib/api";
import { checkIn, licenceView } from "@/lib/licence";
import { requireUser } from "@/lib/session";

/** Check the licence with the Control Panel now ("Check again" on the lock screen). */
export const POST = handle(async () => {
  await requireUser({ allowLocked: true });
  const result = await checkIn();
  return ok({ ...result, licence: await licenceView() });
});
