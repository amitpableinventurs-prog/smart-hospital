import { handle, ok, readJson } from "@/lib/api";
import { startTrial } from "@/lib/licence";

/** First run without a licence key (no session yet): { hospital: { hospitalName, contactName, phone, email, city?, referralCode? }, admin? }. Refused once activated. */
export const POST = handle(async (req) => ok(await startTrial(await readJson(req), req)));
