import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";

/**
 * Coarse gate for pages: no valid session cookie -> /login.
 * Role and module checks happen in layouts/pages and in every API route,
 * which also re-check the account against the database.
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);

  // Shared lab reports are opened by patients/doctors without an account; the token is the credential.
  if (pathname.startsWith("/lab-report/")) return NextResponse.next();
  // Biometric attendance machines push punches here; the route accepts only approved serial numbers.
  if (pathname.startsWith("/iclock/")) return NextResponse.next();
  // First-run activation of a client installation, before any account exists.
  if (pathname === "/setup") return NextResponse.next();

  if (pathname === "/login") {
    return session ? NextResponse.redirect(new URL("/", request.url)) : NextResponse.next();
  }
  if (!session) {
    const url = new URL("/login", request.url);
    if (pathname !== "/") url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
