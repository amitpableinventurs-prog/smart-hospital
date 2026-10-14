import { handle, ok } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { inventoryReport } from "@/lib/inventory";
import { requireUser } from "@/lib/session";

type Ctx = { params: Promise<{ report: string }> };

/** valuation · ledger?item=&store=&from=&to= · expiry?days= · consumption?from=&to= · purchases?from=&to= · non-moving?days= */
export const GET = handle<Ctx>(async (req, { params }) => {
  await requireUser({ module: "inventory" });
  const { report } = await params;
  await connectDB();
  return ok(await inventoryReport(report, new URL(req.url)));
});
