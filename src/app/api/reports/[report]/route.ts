import { ApiError, handle, ok } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { REPORTS } from "@/lib/reports";
import { requireUser } from "@/lib/session";

type Ctx = { params: Promise<{ report: string }> };

/** /api/reports/daybook?date= · sales-register?from=&to= · stock?search=&status=low · expiry?days=90 · outstanding */
export const GET = handle<Ctx>(async (req, { params }) => {
  await requireUser({ module: "reports" });
  const { report } = await params;
  const run = REPORTS[report as keyof typeof REPORTS];
  if (!run) throw new ApiError(404, "Unknown report");
  await connectDB();
  return ok(await run(new URL(req.url)));
});
