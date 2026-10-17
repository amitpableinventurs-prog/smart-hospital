import { handle, ok } from "@/lib/api";
import { patientContext } from "@/lib/billing";
import { connectDB } from "@/lib/db";
import { requireUser } from "@/lib/session";

/** Recent visits, current admissions, open bills and dues of a patient: ?patient=(id) */
export const GET = handle(async (req) => {
  await requireUser({ module: "billing" });
  await connectDB();
  return ok(await patientContext(new URL(req.url).searchParams.get("patient") ?? ""));
});
