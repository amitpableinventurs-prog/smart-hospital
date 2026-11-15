import "server-only";
import { ApiError } from "./api";
import { logActivity } from "./audit";
import {
  BILL_TEMPLATES,
  DEFAULT_PRINT_SETTINGS,
  HEX_COLOR_RE,
  LOGO_MODES,
  LOGO_SIZES,
  MAX_PRINT_LOGO,
  PAPER_SIZES,
  PRINT_LOGO_RE,
  type BillPrintSettings,
} from "./bill-print";
import { hospitalInfo } from "./billing";
import type { SessionUser } from "./session";
import { BillPrintSettingsModel } from "@/models/billing";

const oneOf = <T extends string>(list: readonly T[], v: unknown, fallback: T): T => (list.includes(v as T) ? (v as T) : fallback);
const keys = <T extends { key: string }>(list: readonly T[]) => list.map((x) => x.key as T["key"]);

/** Stored settings over the defaults, so a missing or older document still prints. */
function normalize(d: Record<string, unknown> | null): BillPrintSettings {
  const D = DEFAULT_PRINT_SETTINGS;
  if (!d) return { ...D };
  const str = (k: keyof BillPrintSettings) => (typeof d[k] === "string" ? (d[k] as string) : (D[k] as string));
  const bool = (k: keyof BillPrintSettings) => (typeof d[k] === "boolean" ? (d[k] as boolean) : (D[k] as boolean));
  const customLogo = typeof d.customLogo === "string" && PRINT_LOGO_RE.test(d.customLogo) ? d.customLogo : null;
  return {
    template: oneOf(keys(BILL_TEMPLATES), d.template, D.template),
    accent: typeof d.accent === "string" && HEX_COLOR_RE.test(d.accent) ? d.accent : D.accent,
    logo: oneOf(keys(LOGO_MODES), d.logo, D.logo),
    customLogo,
    logoSize: oneOf(keys(LOGO_SIZES), d.logoSize, D.logoSize),
    headerNote: str("headerNote"),
    terms: str("terms"),
    footer: str("footer"),
    signatureLabel: str("signatureLabel"),
    showReceipts: bool("showReceipts"),
    showStamp: bool("showStamp"),
    paper: oneOf(PAPER_SIZES, d.paper, D.paper),
  };
}

export async function getPrintSettings() {
  const d = await BillPrintSettingsModel.findById("bill").lean();
  return { settings: normalize(d as Record<string, unknown> | null), hospital: hospitalInfo(), updatedByName: d?.updatedByName ?? null, updatedAt: d?.updatedAt ? new Date(d.updatedAt).toISOString() : null };
}

export async function savePrintSettings(body: Record<string, unknown>, user: SessionUser, req: Request) {
  const errors: Record<string, string> = {};
  const text = (k: string, max: number) => {
    const v = typeof body[k] === "string" ? (body[k] as string).trim() : "";
    if (v.length > max) errors[k] = `Keep this under ${max} characters`;
    return v.slice(0, max);
  };
  const pick = <T extends string>(k: string, list: readonly T[], label: string) => {
    if (!list.includes(body[k] as T)) errors[k] = `Choose a ${label}`;
    return body[k] as T;
  };

  const template = pick("template", keys(BILL_TEMPLATES), "template");
  const logo = pick("logo", keys(LOGO_MODES), "logo option");
  const logoSize = pick("logoSize", keys(LOGO_SIZES), "logo size");
  const paper = pick("paper", PAPER_SIZES, "paper size");
  const accent = typeof body.accent === "string" ? body.accent.trim() : "";
  if (!HEX_COLOR_RE.test(accent)) errors.accent = "Choose a colour (#rrggbb)";

  let customLogo: string | null = null;
  if (body.customLogo != null && body.customLogo !== "") {
    customLogo = String(body.customLogo);
    if (!PRINT_LOGO_RE.test(customLogo)) errors.customLogo = "Upload a PNG, JPEG or WebP image";
    else if (customLogo.length > MAX_PRINT_LOGO) errors.customLogo = "This logo is too large; use a smaller image";
  }
  if (logo === "custom" && !customLogo && !errors.customLogo) errors.customLogo = "Upload a logo, or choose another logo option";

  const settings: BillPrintSettings = {
    template,
    accent,
    logo,
    customLogo,
    logoSize,
    headerNote: text("headerNote", 120),
    terms: text("terms", 800),
    footer: text("footer", 200),
    signatureLabel: text("signatureLabel", 60) || DEFAULT_PRINT_SETTINGS.signatureLabel,
    showReceipts: body.showReceipts !== false,
    showStamp: body.showStamp !== false,
    paper,
  };
  if (Object.keys(errors).length) throw new ApiError(422, "Please correct the highlighted fields", errors);

  await BillPrintSettingsModel.updateOne({ _id: "bill" }, { $set: { ...settings, updatedByName: user.name } }, { upsert: true });
  await logActivity({ req, user, action: "update", module: "billing", resource: "print_settings", summary: `Updated bill print template (${BILL_TEMPLATES.find((t) => t.key === template)?.label}, ${LOGO_MODES.find((l) => l.key === logo)?.label.toLowerCase()})` });
  return getPrintSettings();
}
