import { ApiError, handle, ok, readJson } from "@/lib/api";
import { importLog, listPunches, reprocess } from "@/lib/biometric";
import { connectDB } from "@/lib/db";
import { requireUser } from "@/lib/session";

/** Punch log: ?date=YYYY-MM-DD&search=&filter=unmatched|not-applied&page= */
export const GET = handle(async (req) => {
  await requireUser({ module: "hr" });
  await connectDB();
  const { items, pagination } = await listPunches(new URL(req.url));
  return ok(items, { pagination });
});

/** { action: "import", text, fileName? } — an exported log file; { action: "reprocess", from, to } — match and apply again. */
export const POST = handle(async (req) => {
  const user = await requireUser({ module: "hr" });
  const body = await readJson(req);
  await connectDB();
  if (body.action === "import") return ok(await importLog(body, user, req));
  if (body.action === "reprocess") return ok(await reprocess(body, user, req));
  throw new ApiError(400, "Unknown action");
});
