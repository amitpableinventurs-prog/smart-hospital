import type { ModuleKey } from "./modules";

/**
 * Control Panel vocabulary shared by its screens and the server: plans,
 * licence payments, and the vendor's sales pipeline (leads, partners,
 * coupons). Keep this file free of server-only imports.
 */

export const LEAD_STATUSES = ["New", "Contacted", "Demo scheduled", "Trial", "Negotiation", "Won", "Lost"] as const;
export const LEAD_SOURCES = ["Website", "Free trial", "Referral", "Partner", "Phone call", "Visit", "Exhibition", "Social media", "Other"] as const;
export const PARTNER_TYPES = ["Reseller", "Referral", "Agent"] as const;
export const COUPON_KINDS = ["Percent", "Flat"] as const;
export const PAYMENT_STATUSES = ["Created", "Paid", "Failed", "Cancelled"] as const;
/** How a licence payment was received; "Razorpay" is the in-app online payment. */
export const PAYMENT_METHODS = ["Razorpay", "UPI", "Bank Transfer", "Cash", "Cheque", "Card"] as const;
export const MANUAL_METHODS = PAYMENT_METHODS.filter((m) => m !== "Razorpay");

export type LeadStatus = (typeof LEAD_STATUSES)[number];
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export interface PlanRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  features: string[];
  modules: ModuleKey[];
  durationDays: number;
  price: number;
  gstPct: number;
  graceDays: number;
  /** Staff logins (admins) allowed; 0 = unlimited. */
  maxUsers: number;
  /** The free-trial plan offered on the setup screen (at most one). */
  trial: boolean;
  /** Listed on the pricing page and in the hospital's renewal screen. */
  public: boolean;
  active: boolean;
  sortOrder: number;
  clients: number;
}

export interface Quote {
  plan: { code: string; name: string; durationDays: number };
  price: number;
  coupon: { code: string; label: string } | null;
  discount: number;
  taxable: number;
  gstPct: number;
  gst: number;
  total: number;
  /** When the licence would run until after this payment (ISO). */
  periodFrom: string;
  periodTo: string;
}

export interface PaymentRow {
  id: string;
  code: string;
  client: { id: string; code: string; name: string };
  plan: { code: string; name: string };
  durationDays: number;
  channel: "Online" | "Manual";
  method: string;
  status: PaymentStatus;
  price: number;
  discount: number;
  couponCode: string | null;
  taxable: number;
  gstPct: number;
  gst: number;
  total: number;
  reference: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  paidAt: string | null;
  partner: { id: string; name: string } | null;
  commission: number;
  commissionPaid: boolean;
  notes: string | null;
  recordedByName: string | null;
  error: string | null;
  createdAt: string | null;
}

/** What the vendor prints on invoices (VENDOR_* settings on the Control Panel server). */
export interface VendorInfo {
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  gstin: string | null;
}

export interface InvoiceView {
  payment: PaymentRow;
  vendor: VendorInfo;
  customer: { name: string; code: string; address: string | null; city: string | null; gstin: string | null; contactName: string | null; phone: string | null; email: string | null };
}

export const r2 = (n: number) => Math.round(n * 100) / 100;

/** Price → coupon discount → GST, the same on the Control Panel and in the hospital's renewal screen. */
export function priceOf(price: number, gstPct: number, coupon?: { kind: string; value: number } | null) {
  const discount = !coupon ? 0 : coupon.kind === "Percent" ? r2((price * Math.min(100, Math.max(0, coupon.value))) / 100) : r2(Math.min(price, Math.max(0, coupon.value)));
  const taxable = r2(price - discount);
  const gst = r2((taxable * gstPct) / 100);
  return { price: r2(price), discount, taxable, gstPct, gst, total: r2(taxable + gst) };
}

export const durationLabel = (days: number) =>
  days % 365 === 0 ? `${days / 365} year${days === 365 ? "" : "s"}` : days % 30 === 0 ? `${days / 30} month${days === 30 ? "" : "s"}` : `${days} days`;

/** How long an offline licence key issued from a client's page runs. */
export const KEY_VALIDITIES = ["month", "year", "date", "current"] as const;
export type KeyValidity = (typeof KEY_VALIDITIES)[number];

/**
 * End of a monthly / yearly licence: calendar months added to the current
 * expiry while a paid licence is still running (an early renewal loses no
 * days), otherwise to today; valid through that whole day. 31 Jan + 1 month = 28/29 Feb.
 */
export function addLicenceMonths(currentExpiry: string | Date | null | undefined, trial: boolean, months: number, now = new Date()) {
  const expiry = currentExpiry ? new Date(currentExpiry) : null;
  const from = !trial && expiry && expiry > now ? expiry : now;
  const to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + months, 1, 23, 59, 59, 999));
  const lastDay = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() + 1, 0)).getUTCDate();
  to.setUTCDate(Math.min(from.getUTCDate(), lastDay));
  return to;
}
