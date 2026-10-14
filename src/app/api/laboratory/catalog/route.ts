import { handle, ok } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { catalog } from "@/lib/laboratory";
import { requireUser } from "@/lib/session";

/** Tests and profiles for booking, priced for a rate plan: ?q=&plan=General (or &ids=a,b to re-price tests) */
export const GET = handle(async (req) => {
  await requireUser({ module: "laboratory" });
  await connectDB();
  const url = new URL(req.url);
  const ids = url.searchParams.get("ids")?.split(",").filter(Boolean) ?? [];
  return ok(await catalog(url.searchParams.get("q")?.trim() ?? "", url.searchParams.get("plan") ?? "General", ids));
});
