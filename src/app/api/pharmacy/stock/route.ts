import { handle, ok } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { searchStock } from "@/lib/pharmacy";
import { requireUser } from "@/lib/session";

/** Item + batch search for the billing screen (FEFO order). */
export const GET = handle(async (req) => {
  await requireUser({ module: "pharmacy" });
  await connectDB();
  return ok(await searchStock(new URL(req.url).searchParams.get("q")?.trim() ?? ""));
});
