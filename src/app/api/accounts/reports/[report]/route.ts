import { ACCOUNTS_REPORTS } from "@/lib/accounts";
import { ApiError, handle, ok } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { GST_REPORTS, gstr1Json } from "@/lib/gst";
import { requireUser } from "@/lib/session";

type Ctx = { params: Promise<{ report: string }> };

const REPORTS = { ...ACCOUNTS_REPORTS, ...GST_REPORTS };

/**
 * Books: trial|pl|cashbank?from=&to= · bs|outstanding?to= · ledger?ledger=&from=&to=
 * GST: gstr1|gstr3b|itc?month=YYYY-MM (or from=&to=) · gstr1-json?month=YYYY-MM (file download)
 */
export const GET = handle<Ctx>(async (req, { params }) => {
  await requireUser({ module: "accounts" });
  const { report } = await params;
  await connectDB();
  const url = new URL(req.url);
  if (report === "gstr1-json") {
    const { filename, json } = await gstr1Json(url);
    return new Response(JSON.stringify(json), {
      headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" },
    });
  }
  const run = REPORTS[report as keyof typeof REPORTS];
  if (!run) throw new ApiError(404, "Unknown report");
  return ok(await run(url));
});
