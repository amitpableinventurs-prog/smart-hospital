import type { FieldDef, RecordValues, ResourceDef } from "./modules";

/**
 * Shared validation used by the browser (instant feedback) and the API
 * (authoritative). The server never trusts the client's result.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^\+?[0-9][0-9\s-]{6,17}$/;
const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const IMAGE_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

export interface ValidationResult {
  values: RecordValues;
  errors: Record<string, string>;
}

function isEmpty(v: unknown) {
  return v === undefined || v === null || (typeof v === "string" && v.trim() === "");
}

function parseField(field: FieldDef, raw: unknown): { value?: RecordValues[string]; error?: string } {
  if (isEmpty(raw)) {
    if (field.required) return { error: `${field.label} is required` };
    return { value: null };
  }

  switch (field.type) {
    case "number": {
      const n = typeof raw === "number" ? raw : Number(String(raw).trim());
      if (!Number.isFinite(n)) return { error: `${field.label} must be a number` };
      if (field.min !== undefined && n < field.min) return { error: `${field.label} must be at least ${field.min}` };
      if (field.max !== undefined && n > field.max) return { error: `${field.label} must be at most ${field.max}` };
      return { value: n };
    }
    case "date": {
      const s = String(raw).trim().slice(0, 10);
      if (!DATE_RE.test(s)) return { error: `${field.label} must be a valid date` };
      const d = new Date(`${s}T00:00:00.000Z`);
      if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return { error: `${field.label} must be a valid date` };
      if (field.past && d.getTime() > Date.now()) return { error: `${field.label} cannot be in the future` };
      if (d.getUTCFullYear() < 1900) return { error: `${field.label} is too far in the past` };
      return { value: d };
    }
    case "datetime": {
      const d = new Date(String(raw));
      if (Number.isNaN(d.getTime())) return { error: `${field.label} must be a valid date and time` };
      return { value: d };
    }
    case "time": {
      const s = String(raw).trim();
      if (!TIME_RE.test(s)) return { error: `${field.label} must be a valid time (HH:MM)` };
      return { value: s };
    }
    case "select": {
      const s = String(raw).trim();
      if (!field.options?.includes(s)) return { error: `${field.label} has an invalid value` };
      return { value: s };
    }
    case "ref": {
      const s = String(raw).trim();
      if (!OBJECT_ID_RE.test(s)) return { error: `Select a valid ${field.label.toLowerCase()}` };
      return { value: s };
    }
    case "multiref": {
      const ids = (Array.isArray(raw) ? raw.map(String) : String(raw).split(",")).map((s) => s.trim()).filter(Boolean);
      if (ids.length === 0) return field.required ? { error: `${field.label} is required` } : { value: null };
      if (ids.some((id) => !OBJECT_ID_RE.test(id))) return { error: `Select valid ${field.label.toLowerCase()}` };
      if (ids.length > 100) return { error: `${field.label}: at most 100` };
      return { value: [...new Set(ids)] };
    }
    case "multiselect": {
      const parts = (Array.isArray(raw) ? raw.map(String) : String(raw).split(",")).map((s) => s.trim()).filter(Boolean);
      if (parts.length === 0) return field.required ? { error: `${field.label} is required` } : { value: null };
      const bad = parts.find((p) => !field.options?.includes(p));
      if (bad) return { error: `${field.label} has an invalid value (${bad})` };
      // Store in the order the options are declared, without duplicates.
      return { value: field.options!.filter((o) => parts.includes(o)).join(",") };
    }
    case "image": {
      const s = String(raw).trim();
      if (!IMAGE_RE.test(s)) return { error: `${field.label} must be a JPEG, PNG or WebP image` };
      if (s.length > (field.maxLength ?? 300_000)) return { error: `${field.label} is too large` };
      return { value: s };
    }
    case "email": {
      const s = String(raw).trim().toLowerCase();
      if (!EMAIL_RE.test(s) || s.length > 254) return { error: `Enter a valid email address` };
      return { value: s };
    }
    case "tel": {
      const s = String(raw).trim();
      if (!PHONE_RE.test(s)) return { error: `Enter a valid phone number` };
      return { value: s };
    }
    default: {
      if (typeof raw !== "string" && typeof raw !== "number") return { error: `${field.label} is invalid` };
      const s = String(raw).trim();
      const max = field.maxLength ?? (field.type === "textarea" ? 2000 : 200);
      if (s.length > max) return { error: `${field.label} must be ${max} characters or fewer` };
      return { value: s };
    }
  }
}

/**
 * Validate input against a resource definition.
 * With `partial`, only fields present in the input are validated (for PATCH),
 * and `existing` supplies the other values for cross-field checks.
 */
export function validateRecord(
  resource: ResourceDef,
  input: Record<string, unknown>,
  opts: { partial?: boolean; existing?: RecordValues } = {}
): ValidationResult {
  const values: RecordValues = {};
  const errors: Record<string, string> = {};

  for (const field of resource.fields) {
    // System-maintained values are never taken from user input.
    if (field.readOnly) continue;
    if (opts.partial && !(field.name in input)) continue;
    let raw = input[field.name];
    // New records fall back to the field's default when a value is omitted.
    if (!opts.partial && isEmpty(raw) && field.default !== undefined) raw = field.default;
    const { value, error } = parseField(field, raw);
    if (error) errors[field.name] = error;
    else values[field.name] = value;
  }

  if (resource.check && Object.keys(errors).length === 0) {
    Object.assign(errors, resource.check({ ...(opts.existing ?? {}), ...values }));
  }

  return { values, errors };
}

export const PASSWORD_MIN = 8;

export function validatePassword(pw: unknown): string | null {
  if (typeof pw !== "string" || pw.length < PASSWORD_MIN) return `Password must be at least ${PASSWORD_MIN} characters`;
  if (pw.length > 128) return "Password must be 128 characters or fewer";
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return "Password must contain letters and numbers";
  return null;
}

export function isValidEmail(v: unknown): v is string {
  return typeof v === "string" && EMAIL_RE.test(v.trim()) && v.length <= 254;
}

export function isObjectId(v: unknown): v is string {
  return typeof v === "string" && OBJECT_ID_RE.test(v);
}
