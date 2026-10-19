import type { ModuleKey } from "./modules";

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
}
