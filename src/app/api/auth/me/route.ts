import { handle, ok } from "@/lib/api";
import { requireUser } from "@/lib/session";

// Allowed while the licence is locked so the lock screen can still show who is signed in.
export const GET = handle(async () => ok(await requireUser({ allowLocked: true })));
