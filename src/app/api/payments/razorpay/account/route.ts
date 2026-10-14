import { handle, ok, readJson } from "@/lib/api";
import { getAccount, removeAccount, saveAccount, serializeAccount } from "@/lib/razorpay";
import { requireUser } from "@/lib/session";

/** The caller's own Razorpay account — for the super admin, the hospital account. */
function ownerOf(user: { id: string; role: string }) {
  return user.role === "super_admin" ? null : user.id;
}

export const GET = handle(async () => {
  const user = await requireUser();
  return ok(serializeAccount(await getAccount(ownerOf(user))));
});

/** { keyId, keySecret?, displayName?, enabled?, shared? } — keySecret blank keeps the saved one. */
export const PUT = handle(async (req) => {
  const user = await requireUser();
  return ok(await saveAccount(ownerOf(user), await readJson(req), user, req));
});

export const DELETE = handle(async (req) => {
  const user = await requireUser();
  return ok(await removeAccount(ownerOf(user), user, req));
});
