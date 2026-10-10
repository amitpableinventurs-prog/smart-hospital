import { handle, ok } from "@/lib/api";
import { deleteRecord, getRecord, updateRecord } from "@/lib/records";

type Ctx = { params: Promise<{ module: string; resource: string; id: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  const { module, resource, id } = await params;
  return ok(await getRecord(module, resource, id, req));
});

export const PATCH = handle<Ctx>(async (req, { params }) => {
  const { module, resource, id } = await params;
  return ok(await updateRecord(module, resource, id, req));
});

export const DELETE = handle<Ctx>(async (req, { params }) => {
  const { module, resource, id } = await params;
  return ok(await deleteRecord(module, resource, id, req));
});
