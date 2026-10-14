import { handle, ok, readJson } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { revokeShare, shareReport } from "@/lib/laboratory";
import { requireUser } from "@/lib/session";

type Ctx = { params: Promise<{ id: string }> };

/** Create (or reuse) the report link and log who it was shared with: { to, channel, recipient? } */
export const POST = handle<Ctx>(async (req, { params }) => {
  const user = await requireUser({ module: "laboratory" });
  const { id } = await params;
  const body = await readJson(req);
  await connectDB();
  return ok(await shareReport(id, body, user, req));
});

/** Revoke the report link. */
export const DELETE = handle<Ctx>(async (req, { params }) => {
  const user = await requireUser({ module: "laboratory" });
  const { id } = await params;
  await connectDB();
  return ok(await revokeShare(id, user, req));
});
