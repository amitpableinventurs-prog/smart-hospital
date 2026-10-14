import { handle, ok } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { listSamples } from "@/lib/laboratory";
import { requireUser } from "@/lib/session";

/** GET /api/laboratory/samples?status=Pending&search=(accession, lab no. or patient)&page= */
export const GET = handle(async (req) => {
  await requireUser({ module: "laboratory" });
  await connectDB();
  const { items, pagination } = await listSamples(new URL(req.url));
  return ok(items, { pagination });
});
