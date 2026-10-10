import { ApiError, handle, ok } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { patientRelated } from "@/lib/records";
import { requireUser } from "@/lib/session";
import { isObjectId } from "@/lib/validation";

type Ctx = { params: Promise<{ id: string }> };

/** Visits, appointments, lab orders, invoices etc. for one patient — only from modules the viewer is assigned to. */
export const GET = handle<Ctx>(async (_req, { params }) => {
  const { id } = await params;
  const user = await requireUser({ module: "patients" });
  if (!isObjectId(id)) throw new ApiError(404, "Patient not found");
  await connectDB();
  return ok(await patientRelated(user, id));
});
