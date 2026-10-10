import { SignJWT, jwtVerify } from "jose";
import type { Role } from "./modules";

/** JWT helpers. Free of Node/DB imports so the proxy can use them too. */

export const SESSION_COOKIE = "mc_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 10; // 10 hours — one working shift

export interface SessionClaims {
  sub: string;
  role: Role;
  tv: number;
}

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("AUTH_SECRET must be set to at least 32 characters in .env.local");
  return new TextEncoder().encode(s);
}

export async function signSession(claims: SessionClaims): Promise<string> {
  return new SignJWT({ role: claims.role, tv: claims.tv })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secret());
}

export async function verifySession(token: string | undefined): Promise<SessionClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    if (typeof payload.sub !== "string") return null;
    return { sub: payload.sub, role: payload.role as Role, tv: Number(payload.tv ?? 0) };
  } catch {
    return null;
  }
}
