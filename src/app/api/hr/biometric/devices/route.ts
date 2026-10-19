import { handle, ok, readJson } from "@/lib/api";
import { listDevices, saveDevice } from "@/lib/biometric";
import { connectDB } from "@/lib/db";
import { requireUser } from "@/lib/session";

/** Biometric machines (including ones waiting for approval) and today's punch counts. */
export const GET = handle(async () => {
  await requireUser({ module: "hr" });
  await connectDB();
  return ok(await listDevices());
});

/** Register, approve, rename or disable a machine: { id?, serialNo?, name, location?, status? } */
export const POST = handle(async (req) => {
  const user = await requireUser({ module: "hr" });
  const body = await readJson(req);
  await connectDB();
  return ok(await saveDevice(body, user, req));
});
