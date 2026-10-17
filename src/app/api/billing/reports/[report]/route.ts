import { ApiError, handle, ok } from "@/lib/api";
import { BILLING_REPORTS } from "@/lib/billing";
import { connectDB } from "@/lib/db";
import { requireUser } from "@/lib/session";

type Ctx = { params: Promise<{ report: string }> };

/**
 * /api/billing/reports/summary?from=&to= · dues?party=patient|payer&running=1&payerType=&search= · ipd · refunds
 * · doctor-fees?from=&to= · closing?date= · recon?status=&mode=
 */
export const GET = handle<Ctx>(async (req, { params }) => {
  await requireUser({ module: "billing" });
  const { report } = await params;
  const run = BILLING_REPORTS[report as keyof typeof BILLING_REPORTS];
  if (!run) throw new ApiError(404, "Unknown report");
  await connectDB();
  return ok(await run(new URL(req.url)));
});
