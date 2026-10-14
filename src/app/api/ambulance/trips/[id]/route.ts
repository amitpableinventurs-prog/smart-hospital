import { handle, ok } from "@/lib/api";
import { getTrip } from "@/lib/ambulance";
import { connectDB } from "@/lib/db";
import { requireUser } from "@/lib/session";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle<Ctx>(async (_req, { params }) => {
  await requireUser({ module: "ambulance" });
  const { id } = await params;
  await connectDB();
  return ok(await getTrip(id));
});
