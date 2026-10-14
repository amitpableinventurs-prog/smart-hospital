import { handle, ok } from "@/lib/api";
import { board } from "@/lib/ambulance";
import { connectDB } from "@/lib/db";
import { requireUser } from "@/lib/session";

/** Open calls, fleet status and crew availability. */
export const GET = handle(async () => {
  await requireUser({ module: "ambulance" });
  await connectDB();
  return ok(await board());
});
