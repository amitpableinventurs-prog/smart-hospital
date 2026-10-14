import { handle, ok } from "@/lib/api";
import { gatewayFor } from "@/lib/payments";
import { requireUser } from "@/lib/session";

/** Whether the caller can collect online, and into which Razorpay account. */
export const GET = handle(async () => ok(await gatewayFor(await requireUser())));
