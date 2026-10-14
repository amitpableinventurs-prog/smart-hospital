import { handle, ok } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { stockOverview } from "@/lib/inventory";
import { requireUser } from "@/lib/session";

/** Store-wise stock: ?store=&search=&category=&flag=low|expiring|over|reserved */
export const GET = handle(async (req) => {
  await requireUser({ module: "inventory" });
  await connectDB();
  return ok(await stockOverview(new URL(req.url)));
});
