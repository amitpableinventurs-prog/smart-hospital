/** Bill print templates and their settings: shared by the API (validation) and the browser (rendering). */

export const BILL_TEMPLATES = [
  { key: "modern", label: "Modern", description: "Colour header, patient cards and a highlighted total" },
  { key: "classic", label: "Classic", description: "Letterhead with a ruled, bordered table" },
  { key: "compact", label: "Thermal 80 mm", description: "Narrow slip for counter receipt printers" },
] as const;
export type BillTemplate = (typeof BILL_TEMPLATES)[number]["key"];

/** Where the logo on the print comes from. */
export const LOGO_MODES = [
  { key: "branding", label: "Hospital logo", description: "The logo set in the hospital's branding" },
  { key: "custom", label: "Custom logo", description: "A separate logo uploaded just for bills" },
  { key: "none", label: "No logo", description: "Name and address only" },
] as const;
export type LogoMode = (typeof LOGO_MODES)[number]["key"];

export const LOGO_SIZES = [
  { key: "sm", label: "Small" },
  { key: "md", label: "Medium" },
  { key: "lg", label: "Large" },
] as const;
export type LogoSize = (typeof LOGO_SIZES)[number]["key"];

export const PAPER_SIZES = ["A4", "A5"] as const;
export type PaperSize = (typeof PAPER_SIZES)[number];

/** Suggested accent colours; any #rrggbb is accepted. */
export const ACCENT_SWATCHES = ["#16759a", "#0f766e", "#1d4ed8", "#4f46e5", "#7c3aed", "#be123c", "#c2410c", "#334155"];

export interface BillPrintSettings {
  template: BillTemplate;
  accent: string;
  logo: LogoMode;
  /** data:image/...;base64 — only used when `logo` is "custom". */
  customLogo: string | null;
  logoSize: LogoSize;
  /** Line under the hospital name, e.g. "NABH accredited · 24×7 emergency". */
  headerNote: string;
  /** Terms & conditions, one per line. */
  terms: string;
  /** Overrides the branding's bill footer when set. */
  footer: string;
  signatureLabel: string;
  showReceipts: boolean;
  showStamp: boolean;
  paper: PaperSize;
}

export const DEFAULT_PRINT_SETTINGS: BillPrintSettings = {
  template: "modern",
  accent: "#16759a",
  logo: "branding",
  customLogo: null,
  logoSize: "md",
  headerNote: "",
  terms: "",
  footer: "",
  signatureLabel: "Authorised signatory",
  showReceipts: true,
  showStamp: true,
  paper: "A4",
};

export const MAX_PRINT_LOGO = 200_000;
export const PRINT_LOGO_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
export const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/** Hospital letterhead shown on bills (see hospitalInfo() in lib/billing.ts). */
export interface PrintHospital {
  name: string;
  address: string;
  phone: string;
  gstin: string;
  email?: string;
  website?: string;
  /** Same-origin URL of the branding logo, or null. */
  logo?: string | null;
  footer?: string;
}

/** The logo the bill should carry: the custom one, the branding one, or none. */
export function printLogo(s: Pick<BillPrintSettings, "logo" | "customLogo">, hospital: Pick<PrintHospital, "logo">): string | null {
  if (s.logo === "none") return null;
  if (s.logo === "custom" && s.customLogo) return s.customLogo;
  return hospital.logo ?? null;
}
