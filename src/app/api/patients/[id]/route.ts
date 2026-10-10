import { handle, ok } from "@/lib/api";
import { deleteRecord, getRecord, updateRecord } from "@/lib/records";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle<Ctx>(async (req, { params }) => ok(await getRecord("patients", "patients", (await params).id, req)));
export const PATCH = handle<Ctx>(async (req, { params }) => ok(await updateRecord("patients", "patients", (await params).id, req)));
export const DELETE = handle<Ctx>(async (req, { params }) => ok(await deleteRecord("patients", "patients", (await params).id, req)));
