import { handle, ok } from "@/lib/api";
import { adminAccounts, getAccount, serializeAccount } from "@/lib/razorpay";
import { requireUser } from "@/lib/session";
import { GatewayTxn } from "@/models/payments";

/** Super admin: hospital account, every admin's account, and payments needing attention. */
export const GET = handle(async () => {
  await requireUser({ superAdmin: true });
  const since = new Date(Date.now() - 30 * 86400_000);
  const [hospital, admins, unapplied, collected] = await Promise.all([
    getAccount(null),
    adminAccounts(),
    GatewayTxn.countDocuments({ status: "Unapplied" }),
    GatewayTxn.aggregate<{ _id: string; amount: number; count: number }>([
      { $match: { status: "Applied", appliedAt: { $gte: since } } },
      { $group: { _id: "$accountLabel", amount: { $sum: "$amount" }, count: { $sum: 1 } } },
      { $sort: { amount: -1 } },
    ]),
  ]);
  return ok({
    hospital: serializeAccount(hospital),
    admins,
    unapplied,
    collected30d: collected.map((c) => ({ account: c._id, amount: c.amount, count: c.count })),
  });
});
