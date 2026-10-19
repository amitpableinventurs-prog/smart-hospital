import { handle, ok, readJson } from "@/lib/api";
import { getClient, updateClient } from "@/lib/control";
import { connectDB } from "@/lib/db";
import { requireUser } from "@/lib/session";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle<Ctx>(async (_req, { params }) => {
  await requireUser({ superAdmin: true });
  await connectDB();
  return ok(await getClient((await params).id));
});

/** Change modules, status, expiry, grace days, upload, domain, notice or contact details. */
export const PATCH = handle<Ctx>(async (req, { params }) => {
  const user = await requireUser({ superAdmin: true });
  const body = await readJson(req);
  await connectDB();
  return ok(await updateClient((await params).id, body, user, req));
});
