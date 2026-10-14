import { handle, ok, readJson } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { createDoc, listDocs } from "@/lib/inventory";
import { requireUser } from "@/lib/session";

/** GET /api/inventory/docs?type=grn&search=&status=&store=&supplier=&from=&to=&page= */
export const GET = handle(async (req) => {
  await requireUser({ module: "inventory" });
  await connectDB();
  const { items, pagination } = await listDocs(new URL(req.url));
  return ok(items, { pagination });
});

/** Create a stock document: { type, ...header, lines: [...] } (see lib/inventory-docs.ts). */
export const POST = handle(async (req) => {
  const user = await requireUser({ module: "inventory" });
  const body = await readJson(req);
  await connectDB();
  return ok(await createDoc(body.type, body, user, req), { status: 201 });
});
