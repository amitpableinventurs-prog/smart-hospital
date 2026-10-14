import { handle, ok } from "@/lib/api";
import { listTxns } from "@/lib/payments";
import { requireUser } from "@/lib/session";

/** ?kind=&id= (one record) &status= (or "attention") &q= &page= */
export const GET = handle(async (req) => {
  const user = await requireUser();
  const { rows, pagination } = await listTxns(new URL(req.url), user);
  return ok(rows, { pagination });
});
