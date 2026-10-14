import { handle, ok } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { searchItems } from "@/lib/inventory";
import { requireUser } from "@/lib/session";

/** Item lookup for line entry and barcode scanning, with stock in a store: ?q=&store= (or &ids=a,b) */
export const GET = handle(async (req) => {
  await requireUser({ module: "inventory" });
  await connectDB();
  const url = new URL(req.url);
  const ids = url.searchParams.get("ids")?.split(",").filter(Boolean) ?? [];
  return ok(await searchItems(url.searchParams.get("q")?.trim() ?? "", url.searchParams.get("store"), ids));
});
