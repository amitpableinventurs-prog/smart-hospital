import { handle, ok, readJson } from "@/lib/api";
import { receiveSync } from "@/lib/control";
import { connectDB } from "@/lib/db";

/** An installation uploading its data (Authorization: Bearer <install token>); see receiveSync. */
export const POST = handle(async (req) => {
  const body = await readJson(req);
  await connectDB();
  return ok(await receiveSync(body, req));
});
