import { handle, ok } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { getRecordModel } from "@/models/records";

export const GET = handle(async () => {
  await requireUser({ module: "patients" });
  await connectDB();
  const Patient = getRecordModel("patients", "patients")!;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const [total, opd, ipd, today] = await Promise.all([
    Patient.countDocuments({}),
    Patient.countDocuments({ patientType: "OPD" }),
    Patient.countDocuments({ patientType: "IPD" }),
    Patient.countDocuments({ createdAt: { $gte: startOfToday } }),
  ]);
  return ok({ total, opd, ipd, today });
});
