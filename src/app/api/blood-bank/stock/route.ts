import { handle, ok } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { BLOOD_COMPONENTS, BLOOD_GROUPS } from "@/lib/modules";
import { RULES } from "@/lib/rules";
import { requireUser } from "@/lib/session";
import { getRecordModel } from "@/models/records";

/** Available (screened, unexpired) bags by blood group × component, plus near-expiry and pending demand. */
export const GET = handle(async () => {
  await requireUser({ module: "blood_bank" });
  await connectDB();
  await RULES["blood_bank.units"].beforeList?.();

  const soon = new Date(Date.now() + 7 * 86400_000);
  const [available, expiring, demand] = await Promise.all([
    getRecordModel("blood_bank", "units")!.aggregate<{ _id: { g: string; c: string }; n: number }>([
      { $match: { status: "Available", screening: "Passed" } },
      { $group: { _id: { g: "$bloodGroup", c: "$component" }, n: { $sum: 1 } } },
    ]),
    getRecordModel("blood_bank", "units")!.countDocuments({ status: "Available", screening: "Passed", expiryDate: { $lte: soon } }),
    getRecordModel("blood_bank", "requests")!.aggregate<{ _id: string; n: number }>([
      { $match: { status: { $in: ["Pending", "Partially Issued"] } } },
      { $group: { _id: "$bloodGroup", n: { $sum: "$unitsRequired" } } },
    ]),
  ]);

  const count = (g: string, c: string) => available.find((a) => a._id.g === g && a._id.c === c)?.n ?? 0;
  return ok({
    components: BLOOD_COMPONENTS,
    groups: BLOOD_GROUPS.map((g) => ({
      group: g,
      byComponent: BLOOD_COMPONENTS.map((c) => count(g, c)),
      total: BLOOD_COMPONENTS.reduce((s, c) => s + count(g, c), 0),
      demand: demand.find((d) => d._id === g)?.n ?? 0,
    })),
    expiringIn7Days: expiring,
    pendingScreening: await getRecordModel("blood_bank", "units")!.countDocuments({ status: "Available", screening: "Pending" }),
  });
});
