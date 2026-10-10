import { handle, ok } from "@/lib/api";
import { logActivity } from "@/lib/audit";
import { SESSION_COOKIE } from "@/lib/auth";
import { getSessionUser } from "@/lib/session";

export const POST = handle(async (req) => {
  const user = await getSessionUser().catch(() => null);
  if (user) await logActivity({ req, user, action: "logout", module: "system", summary: "Signed out" });
  const res = ok({ signedOut: true });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
});
