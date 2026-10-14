import { handle, ok } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { patientContext } from "@/lib/laboratory";
import { requireUser } from "@/lib/session";

/** Patient summary plus recent OPD visits and current IPD admissions: ?patient=(id) */
export const GET = handle(async (req) => {
  await requireUser({ module: "laboratory" });
  await connectDB();
  return ok(await patientContext(new URL(req.url).searchParams.get("patient") ?? ""));
});
