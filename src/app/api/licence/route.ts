import { handle, ok } from "@/lib/api";
import { appMode, controlUrl } from "@/lib/deployment";
import { licenceView } from "@/lib/licence";
import { requireUser } from "@/lib/session";
import { syncStatus } from "@/lib/sync";

/** This installation's licence and upload state (works while locked, for the lock screen). */
export const GET = handle(async () => {
  const user = await requireUser({ allowLocked: true });
  const view = await licenceView();
  return ok({ ...view, controlUrl: user.role === "super_admin" ? controlUrl() || null : null, sync: user.role === "super_admin" && appMode() === "client" ? await syncStatus() : null });
});
