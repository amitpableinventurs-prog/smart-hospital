import { handle, ok, readJson } from "@/lib/api";
import { assertControl } from "@/lib/control";
import { connectDB } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { invoiceView, paymentAction } from "@/lib/subscriptions";

type Ctx = { params: Promise<{ id: string }> };

/** Invoice of a paid licence payment. */
export const GET = handle<Ctx>(async (_req, { params }) => {
  await requireUser({ superAdmin: true });
  assertControl();
  await connectDB();
  return ok(await invoiceView((await params).id));
});

/** { action: "sync" | "cancel" | "commission-paid" | "commission-unpaid" } */
export const POST = handle<Ctx>(async (req, { params }) => {
  const user = await requireUser({ superAdmin: true });
  const body = await readJson(req);
  await connectDB();
  return ok(await paymentAction((await params).id, body, user, req));
});
