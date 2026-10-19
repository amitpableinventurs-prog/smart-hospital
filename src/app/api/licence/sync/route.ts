import { ApiError, handle, ok } from "@/lib/api";
import { appMode } from "@/lib/deployment";
import { runSync } from "@/lib/sync";
import { requireUser } from "@/lib/session";

/** Upload changes to the Control Panel now. */
export const POST = handle(async () => {
  await requireUser({ superAdmin: true });
  if (appMode() !== "client") throw new ApiError(404, "Not a client installation");
  return ok(await runSync());
});
