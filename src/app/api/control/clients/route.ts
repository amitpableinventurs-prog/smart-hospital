import { handle, ok, readJson } from "@/lib/api";
import { createClient, listClients } from "@/lib/control";
import { connectDB } from "@/lib/db";
import { requireUser } from "@/lib/session";

/** Control Panel: licensed hospitals. ?search=&status= */
export const GET = handle(async (req) => {
  await requireUser({ superAdmin: true });
  await connectDB();
  return ok(await listClients(new URL(req.url)));
});

/** Issue a licence: { name, modules[], expiresAt?, graceDays?, syncEnabled?, domain?, dnsTarget?, contact… } → client + licence key (shown once). */
export const POST = handle(async (req) => {
  const user = await requireUser({ superAdmin: true });
  const body = await readJson(req);
  await connectDB();
  return ok(await createClient(body, user, req), { status: 201 });
});
