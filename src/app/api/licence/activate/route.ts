import { handle, ok, readJson } from "@/lib/api";
import { activate } from "@/lib/licence";

/** First-run activation (no session yet): { licenceKey, admin?: { name, email, password } }. Refused once activated. */
export const POST = handle(async (req) => ok(await activate(await readJson(req), req)));
