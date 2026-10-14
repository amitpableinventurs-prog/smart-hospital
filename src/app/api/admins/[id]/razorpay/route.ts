import { ApiError, handle, ok, readJson } from "@/lib/api";
import { getAccount, removeAccount, saveAccount, serializeAccount } from "@/lib/razorpay";
import { requireUser } from "@/lib/session";
import { isObjectId } from "@/lib/validation";
import { User } from "@/models/User";

type Ctx = { params: Promise<{ id: string }> };

async function adminId(params: Ctx["params"]) {
  const { id } = await params;
  if (!isObjectId(id) || !(await User.exists({ _id: id, role: "admin" }))) throw new ApiError(404, "Admin not found");
  return id;
}

/** Super admin views / sets / removes an admin's own Razorpay account. */
export const GET = handle<Ctx>(async (_req, { params }) => {
  await requireUser({ superAdmin: true });
  return ok(serializeAccount(await getAccount(await adminId(params))));
});

export const PUT = handle<Ctx>(async (req, { params }) => {
  const me = await requireUser({ superAdmin: true });
  return ok(await saveAccount(await adminId(params), await readJson(req), me, req));
});

export const DELETE = handle<Ctx>(async (req, { params }) => {
  const me = await requireUser({ superAdmin: true });
  return ok(await removeAccount(await adminId(params), me, req));
});
