import "server-only";
import { createPrivateKey, createPublicKey, randomUUID, sign, verify } from "node:crypto";
import { ApiError } from "./api";
import { LICENCE_PUBLIC_KEY } from "./licence-public-key";
import { isModuleKey, type ModuleKey } from "./modules";

/**
 * Offline licence keys: the licence itself, signed with the vendor's Ed25519
 * key, so an installation can be activated and renewed without ever reaching
 * the Control Panel. One key works on any computer until it expires.
 *
 *   SH1.<base64url JSON>.<base64url signature>
 *
 * The Control Panel signs with LICENCE_SIGNING_KEY; installations verify with
 * the public key compiled into the app (lib/licence-public-key.ts). Both are
 * created by `npm run licence-key -- init`, which also issues keys from the
 * command line (scripts/licence-key.mjs uses the same format).
 */

export const OFFLINE_KEY_PREFIX = "SH1.";

export interface OfflineLicence {
  v: 1;
  /** Random id of this key. */
  id: string;
  code: string;
  hospital: string;
  modules: ModuleKey[];
  /** ISO time; null = no expiry. */
  expiresAt: string | null;
  /** Staff logins allowed; 0 = unlimited. */
  maxUsers: number;
  plan: { code: string; name: string } | null;
  trial: boolean;
  issuedAt: string;
}

export const isOfflineKey = (key: string) => key.trim().startsWith(OFFLINE_KEY_PREFIX);

const b64 = (b: Buffer) => b.toString("base64url");

/** Control Panel: whether this server can sign offline keys (LICENCE_SIGNING_KEY is set). */
export const offlineKeysEnabled = () => !!process.env.LICENCE_SIGNING_KEY?.trim();

/** Control Panel: a 503 unless offline keys can be signed — check before changing anything the key depends on. */
export function assertOfflineKeys() {
  if (!offlineKeysEnabled()) throw new ApiError(503, "Offline keys are not set up on this server. Run `npm run licence-key -- init` and set LICENCE_SIGNING_KEY.");
}

/** Control Panel: sign a licence. Needs LICENCE_SIGNING_KEY (base64 PKCS#8 DER). */
export function signOfflineKey(lic: Omit<OfflineLicence, "v" | "id" | "issuedAt">): string {
  assertOfflineKeys();
  const key = createPrivateKey({ key: Buffer.from(process.env.LICENCE_SIGNING_KEY!.trim(), "base64"), format: "der", type: "pkcs8" });
  const body: OfflineLicence = { v: 1, id: randomUUID(), ...lic, issuedAt: new Date().toISOString() };
  const json = Buffer.from(JSON.stringify(body));
  return `${OFFLINE_KEY_PREFIX}${b64(json)}.${b64(sign(null, json, key))}`;
}

/** Installation: the licence in a key, or a 422 when the key was not issued by the vendor. */
export function verifyOfflineKey(raw: string): OfflineLicence {
  const invalid = () => new ApiError(422, "This licence key is not valid. Copy the whole key from your vendor.", { licenceKey: "This licence key is not valid" });
  const parts = raw.replace(/\s+/g, "").slice(OFFLINE_KEY_PREFIX.length).split(".");
  if (parts.length !== 2 || !LICENCE_PUBLIC_KEY) throw invalid();
  const json = Buffer.from(parts[0], "base64url");
  const key = createPublicKey({ key: Buffer.from(LICENCE_PUBLIC_KEY, "base64"), format: "der", type: "spki" });
  if (!verify(null, json, key, Buffer.from(parts[1], "base64url"))) throw invalid();
  let lic: OfflineLicence;
  try {
    lic = JSON.parse(json.toString("utf8"));
  } catch {
    throw invalid();
  }
  if (lic.v !== 1 || !lic.code || !lic.hospital) throw invalid();
  return { ...lic, modules: (lic.modules ?? []).filter(isModuleKey), maxUsers: Number(lic.maxUsers) || 0, trial: !!lic.trial, plan: lic.plan ?? null, expiresAt: lic.expiresAt ?? null };
}
