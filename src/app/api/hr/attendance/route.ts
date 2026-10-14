import { handle, ok, readJson } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { attendanceRegister, saveAttendance } from "@/lib/hr";
import { requireUser } from "@/lib/session";

/** GET /api/hr/attendance?date=2026-10-13&department=&category=&search= — the day's register. */
export const GET = handle(async (req) => {
  await requireUser({ module: "hr" });
  await connectDB();
  return ok(await attendanceRegister(new URL(req.url)));
});

/** { date, entries: [{ staff, status, inTime?, outTime?, overtimeHours?, remarks? }] } (status "" clears the mark) */
export const POST = handle(async (req) => {
  const user = await requireUser({ module: "hr" });
  const body = await readJson(req);
  await connectDB();
  return ok(await saveAttendance(body, user, req));
});
