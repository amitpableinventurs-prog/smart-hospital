import { createVoucher, listVouchers } from "@/lib/accounts";
import { handle, ok, readJson } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { requireUser } from "@/lib/session";

/** Day book: GET /api/accounts/vouchers?type=&origin=manual|auto&status=&from=&to=&ledger=&search=&page= */
export const GET = handle(async (req) => {
  await requireUser({ module: "accounts" });
  await connectDB();
  const { data, pagination } = await listVouchers(new URL(req.url));
  return ok(data, { pagination });
});

/** Manual voucher: { type, date, narration?, refNo?, entries: [{ ledger, dr?, cr?, note? }] } */
export const POST = handle(async (req) => {
  const user = await requireUser({ module: "accounts" });
  const body = await readJson(req);
  await connectDB();
  return ok(await createVoucher(body, user, req), { status: 201 });
});
