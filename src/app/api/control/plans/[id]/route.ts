import { handle, ok, readJson } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { deletePlan, updatePlan } from "@/lib/subscriptions";

type Ctx = { params: Promise<{ id: string }> };

/** Any plan field; `applyToClients: true` also updates the modules, grace period and user limit of clients on it. */
export const PATCH = handle<Ctx>(async (req, { params }) => {
  const user = await requireUser({ superAdmin: true });
  const body = await readJson(req);
  await connectDB();
  return ok(await updatePlan((await params).id, body, user, req));
});

/** Only plans that no client or payment uses. */
export const DELETE = handle<Ctx>(async (req, { params }) => {
  const user = await requireUser({ superAdmin: true });
  await connectDB();
  return ok(await deletePlan((await params).id, user, req));
});
