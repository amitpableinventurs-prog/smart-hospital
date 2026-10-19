import { handle, ok, readJson } from "@/lib/api";
import { activateInstallation } from "@/lib/control";
import { connectDB } from "@/lib/db";

/** Called by a client installation's setup screen: { licenceKey, installationId, host, version }. No session; the key is the credential. */
export const POST = handle(async (req) => {
  const body = await readJson(req);
  await connectDB();
  return ok(await activateInstallation(body, req));
});
