import { handle, ok, readJson } from "@/lib/api";
import { enterOfflineKey, licenceView } from "@/lib/licence";
import { requireUser } from "@/lib/session";

/** Super admin: { licenceKey } — renew or change the licence with an offline key (also while locked). */
export const POST = handle(async (req) => {
  const user = await requireUser({ superAdmin: true, allowLocked: true });
  const result = await enterOfflineKey(await readJson(req), user, req);
  return ok({ ...result, licence: await licenceView() });
});
