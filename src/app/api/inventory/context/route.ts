import { handle, ok } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { ensureStore } from "@/lib/inventory";
import { requireUser } from "@/lib/session";

/** Default stores for forms (created on first use). */
export const GET = handle(async () => {
  await requireUser({ module: "inventory" });
  await connectDB();
  const [main, pharmacy] = await Promise.all([ensureStore("Main Store"), ensureStore("Pharmacy")]);
  return ok({ mainStore: { id: String(main._id), label: String(main.name) }, pharmacyStore: { id: String(pharmacy._id), label: String(pharmacy.name) } });
});
