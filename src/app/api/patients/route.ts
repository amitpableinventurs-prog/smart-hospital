import { handle, ok } from "@/lib/api";
import { createRecord, listRecords } from "@/lib/records";

/**
 * GET  /api/patients?search=Rahul&type=OPD&page=1&limit=10
 * POST /api/patients
 */
export const GET = handle(async (req) => {
  const url = new URL(req.url);
  const type = url.searchParams.get("type");
  if (type) url.searchParams.set("patientType", type);
  const { items, pagination } = await listRecords("patients", "patients", req, url);
  return ok(items, { pagination });
});

export const POST = handle(async (req) => ok(await createRecord("patients", "patients", req), { status: 201 }));
