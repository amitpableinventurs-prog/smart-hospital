import type { PaymentRow, PlanRow, Quote, VendorInfo } from "./control-shared";
import type { ModuleKey } from "./modules";

/** The look and letterhead of one client (its domain / installation), set on the Control Panel. */
export interface Branding {
  /** Replaces "MediCare" in the app. */
  appName: string | null;
  tagline: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  gstin: string | null;
  /** #rrggbb */
  color: string | null;
  /** Data URL. */
  logo: string | null;
  printFooter: string | null;
}

/** What the Control Panel tells an installation about its licence (activation and every check-in). */
export interface LicencePayload {
  clientCode: string;
  hospitalName: string;
  status: "Active" | "Suspended";
  modules: ModuleKey[];
  /** ISO time; null = no expiry. */
  expiresAt: string | null;
  graceDays: number;
  syncEnabled: boolean;
  notice: string | null;
  domain: string | null;
  /** When the vendor asked for everything to be uploaded again. */
  resyncRequestedAt: string | null;
  serverTime: string;
  plan: { code: string; name: string } | null;
  trial: boolean;
  /** Staff logins allowed; 0 = unlimited. */
  maxUsers: number;
  /** Left out when the installation already has the current branding (see brandingAt). */
  branding?: Branding | null;
  brandingAt: string | null;
  vendor: Pick<VendorInfo, "name" | "phone" | "email" | "website"> | null;
}

/** Why a client installation is locked, as shown on the lock screen. */
export type LockReason = "not_activated" | "suspended" | "deactivated" | "expired" | "offline";

export interface LicenceView {
  mode: "standalone" | "control" | "client";
  hospitalName: string | null;
  clientCode: string | null;
  locked: { reason: LockReason; message: string } | null;
  /** Licensed modules; null when the deployment is not licensed (standalone / control). */
  modules: ModuleKey[] | null;
  notice: string | null;
  expiresAt: string | null;
  lastCheckAt: string | null;
  /** Days left before an offline installation locks. */
  offlineDaysLeft: number | null;
  /** Whole days since the last successful check-in. */
  offlineDays: number | null;
  /** Days until the licence expires (negative once expired). */
  expiresInDays: number | null;
  lastError: string | null;
  plan: { code: string; name: string } | null;
  trial: boolean;
  maxUsers: number | null;
  /** Activated with an offline key: renewed by entering a new key, never checks in. */
  offline: boolean;
  vendor: LicencePayload["vendor"];
  /** App name, colour and whether a logo exists (the logo itself is served by /api/branding/logo). */
  brand: { appName: string; color: string | null; logoVersion: string | null };
}

/** The hospital's renewal screen: plans it can buy, its payments, and a priced quote. */
export interface RenewalInfo {
  current: { plan: { code: string; name: string } | null; trial: boolean; expiresAt: string | null };
  plans: Pick<PlanRow, "code" | "name" | "description" | "features" | "modules" | "durationDays" | "price" | "gstPct" | "maxUsers">[];
  online: { enabled: boolean; mode: "test" | "live" | null };
  quote: Quote | null;
  payments: PaymentRow[];
  vendor: VendorInfo;
}

export interface RenewalOrder {
  paymentId: string;
  keyId: string;
  orderId: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  prefill: { name: string; email: string; contact: string };
  quote: Quote;
}
