import { handle, ok, readJson } from "@/lib/api";
import { createTrip, listTrips } from "@/lib/ambulance";
import { connectDB } from "@/lib/db";
import { requireUser } from "@/lib/session";

/** GET /api/ambulance/trips?search=&status=&tripType=&paymentStatus=&vehicle=&patient=&from=&to=&page= */
export const GET = handle(async (req) => {
  await requireUser({ module: "ambulance" });
  await connectDB();
  const { items, pagination } = await listTrips(new URL(req.url));
  return ok(items, { pagination });
});

/** Log a call; include `dispatch: { vehicle, driver, crew, odometerStart? }` to dispatch at once. */
export const POST = handle(async (req) => {
  const user = await requireUser({ module: "ambulance" });
  const body = await readJson(req);
  await connectDB();
  return ok(await createTrip(body, user, req), { status: 201 });
});
