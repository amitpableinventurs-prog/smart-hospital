import { handle, ok } from "@/lib/api";
import { requireUser } from "@/lib/session";

export const GET = handle(async () => ok(await requireUser()));
