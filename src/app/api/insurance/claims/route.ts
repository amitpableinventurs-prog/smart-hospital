import { handle, ok, readJson } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { createClaim, listClaims } from "@/lib/insurance";
import { requireUser } from "@/lib/session";

/** GET /api/insurance/claims?search=&status=&provider=&page= */
export const GET = handle(async (req) => {
  await requireUser({ module: "insurance" });
  await connectDB();
  const { items, pagination } = await listClaims(new URL(req.url));
  return ok(items, { pagination });
});

/** { bill } or { patient, policy, claimType, claimAmount, diagnosis, admissionDate?, dischargeDate?, remarks? } */
export const POST = handle(async (req) => {
  const user = await requireUser({ module: "insurance" });
  const body = await readJson(req);
  await connectDB();
  return ok(await createClaim(body, user, req), { status: 201 });
});
