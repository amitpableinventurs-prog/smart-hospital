import { handle, ok } from "@/lib/api";
import { clientData } from "@/lib/control";
import { connectDB } from "@/lib/db";
import { requireUser } from "@/lib/session";

type Ctx = { params: Promise<{ id: string }> };

/** The client's uploaded data on this server: documents per collection. */
export const GET = handle<Ctx>(async (_req, { params }) => {
  await requireUser({ superAdmin: true });
  await connectDB();
  return ok(await clientData((await params).id));
});
