import { getSettings, saveSettings } from "@/lib/accounts";
import { handle, ok, readJson } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { requireUser } from "@/lib/session";

export const GET = handle(async () => {
  await requireUser({ module: "accounts" });
  await connectDB();
  return ok(await getSettings());
});

/** { modeLedgers: { Cash, Card, UPI, "Bank Transfer", Cheque }, booksFrom?, stateCode? } */
export const PUT = handle(async (req) => {
  const user = await requireUser({ module: "accounts" });
  const body = await readJson(req);
  await connectDB();
  return ok(await saveSettings(body, user, req));
});
