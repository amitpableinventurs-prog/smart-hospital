import { handle, ok } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { supplierDues } from "@/lib/inventory";
import { requireUser } from "@/lib/session";

/** Supplier bills (GRNs and pharmacy purchases) with returns, payments and balances: ?supplier=&status=open */
export const GET = handle(async (req) => {
  await requireUser({ module: "inventory" });
  await connectDB();
  return ok(await supplierDues(new URL(req.url)));
});
