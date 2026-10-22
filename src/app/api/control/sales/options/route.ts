import { handle, ok } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { salesOptions } from "@/lib/sales";
import { requireUser } from "@/lib/session";

/** Plans and active partners for the Control Panel's pickers. */
export const GET = handle(async () => {
  await requireUser({ superAdmin: true });
  await connectDB();
  return ok(await salesOptions());
});
