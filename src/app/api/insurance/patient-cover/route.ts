import { handle, ok } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { patientCover } from "@/lib/insurance";
import { requireUser } from "@/lib/session";

/** GET /api/insurance/patient-cover?patient=<id> — policies, admissions and insurance bills of a patient. */
export const GET = handle(async (req) => {
  await requireUser({ module: "insurance" });
  await connectDB();
  return ok(await patientCover(new URL(req.url).searchParams.get("patient") ?? ""));
});
