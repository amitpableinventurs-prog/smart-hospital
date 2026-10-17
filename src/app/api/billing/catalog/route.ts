import { handle, ok } from "@/lib/api";
import { catalog } from "@/lib/billing";
import { connectDB } from "@/lib/db";
import { requireUser } from "@/lib/session";

/** Services and packages priced for a rate plan: ?q=&category=&plan= · or one doctor's fees: ?doctor=(id) */
export const GET = handle(async (req) => {
  await requireUser({ module: "billing" });
  await connectDB();
  return ok(await catalog(new URL(req.url)));
});
