"use client";

import { cx } from "../ui";

/* ---------- API shapes (see lib/laboratory.ts) ---------- */

export interface ResultRow {
  parameter?: string;
  name: string;
  unit?: string;
  resultType: "Numeric" | "Text" | "Options";
  options?: string;
  normalValue?: string;
  decimals?: number;
  value?: string;
  low?: number;
  high?: number;
  criticalLow?: number;
  criticalHigh?: number;
  rangeText?: string;
  flag?: "" | "L" | "H" | "LL" | "HH" | "A";
}

export interface LabItem {
  id: string;
  test: string;
  testName: string;
  testCode?: string;
  categoryName?: string;
  categoryOrder?: number;
  method?: string;
  sampleType?: string;
  container?: string;
  reportType: "Parametric" | "Descriptive";
  profileName?: string;
  price: number;
  sampleNo?: string;
  status: string;
  outsourceLab?: string;
  outsourceLabName?: string;
  outsourceRef?: string;
  sentOutAt?: string;
  receivedBackAt?: string;
  processingAt?: string;
  results: ResultRow[];
  reportText?: string;
  remarks?: string;
  abnormal?: boolean;
  critical?: boolean;
  enteredAt?: string;
  enteredByName?: string;
  verifiedAt?: string;
  verifiedBy?: string;
  verifiedByName?: string;
  approvedAt?: string;
  approvedByName?: string;
  pathologistName?: string;
  pathologistQualification?: string;
  pathologistRegNo?: string;
  cancelledAt?: string;
  cancelReason?: string;
}

export interface LabSample {
  id: string;
  accessionNo: string;
  sampleType?: string;
  container?: string;
  status: "Pending" | "Collected" | "Received" | "Rejected";
  collectedAt?: string;
  collectedByName?: string;
  receivedAt?: string;
  receivedByName?: string;
  rejectedAt?: string;
  rejectReason?: string;
  recollectOf?: string;
  replacedBy?: string;
}

export interface LabInfo {
  name: string;
  department: string;
  address: string;
  phone: string;
  accreditation: string;
}

export interface LabOrder {
  id: string;
  code: string;
  orderDate: string;
  patient?: string;
  patientName: string;
  patientCode?: string;
  patientGender?: string;
  patientAge?: number;
  patientMobile?: string;
  source: string;
  visitCode?: string;
  admissionCode?: string;
  wardBed?: string;
  doctorName?: string;
  doctorPhone?: string;
  doctorEmail?: string;
  priority: string;
  ratePlan?: string;
  clinicalNotes?: string;
  items: LabItem[];
  samples: LabSample[];
  grossAmount?: number;
  discount?: number;
  netAmount?: number;
  paidAmount?: number;
  payments?: { kind: "Payment" | "Refund"; amount: number; mode: string; reference?: string; at: string; byName?: string }[];
  paymentStatus?: string;
  status: string;
  reportedAt?: string;
  shareToken?: string;
  shareExpiresAt?: string;
  shares?: { to: string; channel: string; recipient?: string; at: string; byName?: string }[];
  cancelReason?: string;
  createdByName?: string;
  createdAt?: string;
  templates?: Record<string, ResultRow[]>;
  lab: LabInfo;
  shared?: boolean;
}

export const REJECT_REASONS = ["Haemolysed", "Clotted", "Insufficient quantity", "Wrong container", "Unlabelled / mislabelled", "Leaked / broken", "Delayed transport", "Other"] as const;

export function rangeLabel(r: Pick<ResultRow, "low" | "high" | "rangeText" | "normalValue">) {
  if (r.rangeText) return r.rangeText;
  const n = (x: unknown): x is number => typeof x === "number";
  if (n(r.low) && n(r.high)) return `${r.low} – ${r.high}`;
  if (n(r.low)) return `≥ ${r.low}`;
  if (n(r.high)) return `≤ ${r.high}`;
  return r.normalValue ?? "";
}

export const FLAG_LABEL: Record<string, string> = { L: "Low", H: "High", LL: "Critical low", HH: "Critical high", A: "Abnormal" };

export function FlagBadge({ flag }: { flag?: string }) {
  if (!flag) return null;
  const critical = flag === "LL" || flag === "HH";
  return (
    <span title={FLAG_LABEL[flag]} className={cx("inline-flex rounded px-1.5 py-0.5 text-[11px] font-bold", critical ? "bg-red-600 text-white" : "bg-red-50 text-red-700 ring-1 ring-inset ring-red-200")}>
      {flag}
    </span>
  );
}

/** Group items by category in report order. */
export function byCategory<T extends { categoryName?: string; categoryOrder?: number }>(items: T[]) {
  const groups = new Map<string, { name: string; order: number; items: T[] }>();
  for (const i of items) {
    const name = i.categoryName || "Other";
    const g = groups.get(name) ?? { name, order: i.categoryOrder ?? 10, items: [] };
    g.items.push(i);
    groups.set(name, g);
  }
  return [...groups.values()].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

export { Barcode } from "../Barcode";
