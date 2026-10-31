import { handle, ok } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { getRecordModel } from "@/models/records";

/** Today's queue and collection for each active clinic. */
export const GET = handle(async () => {
  await requireUser({ module: "clinic" });
  await connectDB();

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const [clinics, tokens, collected] = await Promise.all([
    getRecordModel("clinic", "clinics")!.find({ status: "Active" }).sort({ name: 1 }).populate("doctor", "fullName").lean<Record<string, unknown>[]>(),
    getRecordModel("clinic", "tokens")!.find({ visitDate: today }).select("clinic tokenNo status").lean<{ clinic: unknown; tokenNo: number; status: string }[]>(),
    getRecordModel("clinic", "receipts")!.aggregate<{ _id: unknown; amount: number }>([
      { $match: { receiptDate: today, status: "Paid" } },
      { $lookup: { from: getRecordModel("clinic", "tokens")!.collection.name, localField: "token", foreignField: "_id", as: "t" } },
      { $group: { _id: { $first: "$t.clinic" }, amount: { $sum: "$amount" } } },
    ]),
  ]);

  return ok({
    clinics: clinics.map((c) => {
      const mine = tokens.filter((t) => String(t.clinic) === String(c._id));
      const first = (status: string) => mine.filter((t) => t.status === status).reduce<number | null>((n, t) => (n === null || t.tokenNo < n ? t.tokenNo : n), null);
      const count = (status: string) => mine.filter((t) => t.status === status).length;
      return {
        id: String(c._id),
        name: c.name,
        doctor: (c.doctor as { fullName?: string } | null)?.fullName ?? null,
        roomNo: c.roomNo ?? null,
        hours: `${c.startTime}–${c.endTime}`,
        serving: first("In Consultation"),
        next: first("Waiting"),
        waiting: count("Waiting"),
        completed: count("Completed"),
        missed: count("Cancelled") + count("No-show"),
        collected: collected.find((r) => String(r._id) === String(c._id))?.amount ?? 0,
      };
    }),
  });
});
