import "server-only";
import type { Branding } from "./licence-protocol";

/**
 * The hospital's letterhead for printed bills, reports and slips. On a client
 * installation it comes from the branding set on the Control Panel (kept with
 * the licence, so it works offline); otherwise, or where a field is blank,
 * from the HOSPITAL_* settings.
 */

declare global {
  var __orgBranding: { hospitalName: string | null; branding: Branding | null; version: string | null } | undefined;
}

/** Called whenever the licence is read (lib/licence.ts). */
export function setOrgBranding(hospitalName: string | null, branding: Branding | null, version: string | null) {
  globalThis.__orgBranding = { hospitalName, branding, version };
}

export function orgInfo(fallbackName = "MediCare Hospital") {
  const o = globalThis.__orgBranding;
  const b = o?.branding ?? null;
  const env = (k: string) => process.env[k] || "";
  return {
    name: o?.hospitalName || env("HOSPITAL_NAME") || fallbackName,
    address: b?.address || env("HOSPITAL_ADDRESS"),
    phone: b?.phone || env("HOSPITAL_PHONE"),
    gstin: b?.gstin || env("HOSPITAL_GSTIN"),
    email: b?.email || env("HOSPITAL_EMAIL"),
    website: b?.website || env("HOSPITAL_WEBSITE"),
    footer: b?.printFooter || "",
    /** Same-origin URL of the logo, when one is set. */
    logo: b?.logo ? `/api/branding/logo?v=${encodeURIComponent(o?.version ?? "1")}` : null,
  };
}
