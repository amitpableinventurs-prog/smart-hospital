import { handle, ok } from "@/lib/api";
import { createRecord, listRecords } from "@/lib/records";

type Ctx = { params: Promise<{ module: string; resource: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  const { module, resource } = await params;
  const { items, pagination } = await listRecords(module, resource, req);
  return ok(items, { pagination });
});

export const POST = handle<Ctx>(async (req, { params }) => {
  const { module, resource } = await params;
  return ok(await createRecord(module, resource, req), { status: 201 });
});
