import type { FieldDef } from "./modules";

const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
const dateTimeFmt = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const moneyFmt = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });

const MONEY_FIELDS = /amount|fee|price|cost|salary|paid|discount|^rate$|limit/i;

/** Calendar dates are stored at UTC midnight, so format them in UTC. */
export function formatDate(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : dateFmt.format(d);
}

export function formatDateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : dateTimeFmt.format(d);
}

export function formatMoney(n: unknown) {
  return typeof n === "number" ? moneyFmt.format(n) : "—";
}

export function timeAgo(iso: string | null | undefined) {
  if (!iso) return "Never";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} day${d === 1 ? "" : "s"} ago`;
  return formatDate(iso);
}

export function ageFrom(iso: string | null | undefined) {
  if (!iso) return null;
  const dob = new Date(iso);
  const now = new Date();
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const m = now.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < dob.getUTCDate())) age--;
  return age;
}

/** Render a record value for tables and detail views. */
export function formatValue(field: FieldDef, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  switch (field.type) {
    case "date":
      return formatDate(String(value));
    case "datetime":
      return formatDateTime(String(value));
    case "number":
      return MONEY_FIELDS.test(field.name) ? formatMoney(value) : String(value);
    case "ref": {
      const ref = value as { label?: string; code?: string };
      return ref.code && ref.label && ref.code !== ref.label ? `${ref.label} (${ref.code})` : (ref.label || ref.code || "—");
    }
    case "multiselect":
      return String(value).split(",").join(", ");
    case "multiref":
      return Array.isArray(value) && value.length ? value.map((r) => (r as { label?: string }).label || "—").join(", ") : "—";
    case "image":
      return "Photo";
    default:
      return String(value);
  }
}

/** Convert a stored value into the string an <input> expects. */
export function toInputValue(field: FieldDef, value: unknown): string {
  if (value === null || value === undefined) return "";
  switch (field.type) {
    case "date":
      return String(value).slice(0, 10);
    case "datetime": {
      const d = new Date(String(value));
      if (Number.isNaN(d.getTime())) return "";
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
    case "ref":
      return typeof value === "object" ? String((value as { id?: string }).id ?? "") : String(value);
    case "multiref":
      return Array.isArray(value) ? value.map((r) => (typeof r === "object" ? String((r as { id?: string }).id ?? "") : String(r))).join(",") : "";
    default:
      return String(value);
  }
}

export const ACTION_LABELS: Record<string, string> = {
  login: "Signed in",
  login_failed: "Failed sign-in",
  logout: "Signed out",
  create: "Created",
  update: "Updated",
  delete: "Deleted",
  view: "Viewed",
  admin_create: "Admin created",
  admin_update: "Admin updated",
  admin_password_reset: "Password reset",
  password_change: "Password changed",
};
