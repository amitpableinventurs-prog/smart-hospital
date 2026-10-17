import { statusTone } from "../ui";

/** Shapes returned by /api/billing/* (see lib/billing.ts). */

export interface BillLine {
  id: string;
  kind: "Service" | "Package" | "Doctor Fee" | "Inventory" | "Ambulance" | "Manual";
  category: string;
  name: string;
  code?: string;
  detail?: string;
  unit?: string;
  doctorName?: string;
  feeType?: string;
  serviceDate?: string;
  qty: number;
  rate: number;
  rateEditable?: boolean;
  rateOverridden?: boolean;
  discountPct?: number;
  gstRate?: number;
  gross: number;
  discount: number;
  taxable: number;
  gst: number;
  amount: number;
  sourceCode?: string;
  status: "Active" | "Cancelled";
  cancelReason?: string;
  cancelledByName?: string;
  addedAt?: string;
  addedByName?: string;
}

export interface ReceiptSplit {
  id: string;
  mode: string;
  amount: number;
  reference?: string | null;
  recon: string;
  reconNote?: string;
}

export interface BillReceipt {
  id: string;
  code: string;
  kind: "Advance" | "Payment" | "Refund" | "Settlement";
  amount: number;
  splits: ReceiptSplit[];
  writeOff?: number;
  toPatient?: number;
  reason?: string;
  approvedBy?: string;
  at: string;
  byName?: string;
  shiftCode?: string;
}

export interface DeptDue {
  source: string;
  id: string;
  code: string;
  date: string;
  net: number;
  paid: number;
  balance: number;
}

export interface Bill {
  id: string;
  code: string;
  billDate: string;
  billType: string;
  patient: string;
  patientName: string;
  patientCode?: string;
  patientAge?: number;
  patientGender?: string;
  patientMobile?: string;
  visitCode?: string;
  admission?: string;
  admissionCode?: string;
  admissionDate?: string;
  wardBed?: string;
  dischargeDate?: string;
  doctor?: string;
  doctorName?: string;
  department?: string;
  ratePlan: string;
  payerType: "Self" | "Corporate" | "Insurance";
  corporate?: string;
  insuranceProvider?: string;
  payerName?: string;
  tpaName?: string;
  policyNo?: string;
  authNo?: string;
  payerLimit?: number;
  coveragePct?: number;
  creditDays?: number;
  lines: BillLine[];
  grossAmount: number;
  lineDiscount: number;
  billDiscount: number;
  discountAmount: number;
  discountReason?: string;
  discountApprovedBy?: string;
  taxableAmount: number;
  gstAmount: number;
  roundOff: number;
  netAmount: number;
  payerShare: number;
  patientShare: number;
  movedToPatient: number;
  patientPaid: number;
  payerPaid: number;
  payerWriteOff: number;
  patientDue: number;
  payerDue: number;
  refundDue: number;
  receipts: BillReceipt[];
  status: "Provisional" | "Final" | "Closed" | "Cancelled";
  paymentStatus: string;
  finalizedAt?: string;
  finalizedByName?: string;
  claimCode?: string;
  cancelledAt?: string;
  cancelReason?: string;
  cancelledByName?: string;
  notes?: string;
  createdByName?: string;
  createdAt: string;
  deptDues: DeptDue[];
  hospital: { name: string; address: string; phone: string; gstin: string };
  stayDays: number | null;
}

/** Row of the bill register and the dues / refund worklists. */
export interface BillRow {
  id: string;
  code: string;
  billDate: string;
  billType: string;
  patient: string;
  patientName: string;
  patientCode: string | null;
  patientAge: number | null;
  patientGender: string | null;
  patientMobile: string | null;
  admissionCode: string | null;
  wardBed: string | null;
  doctorName: string | null;
  payerType: string;
  payerName: string | null;
  status: string;
  paymentStatus: string;
  netAmount: number;
  discountAmount: number;
  patientShare: number;
  payerShare: number;
  patientPaid: number;
  patientDue: number;
  payerDue: number;
  refundDue: number;
  charges: number;
  heads: string[];
  finalizedAt: string | null;
  createdByName: string | null;
  claimCode: string | null;
  policyNo: string | null;
}

export interface ShiftTotals {
  byMode: { mode: string; collected: number; refunded: number; net: number }[];
  collected: number;
  refunded: number;
  net: number;
  receipts: number;
  refunds: number;
}

export interface Shift {
  id: string;
  code: string;
  userName: string;
  counter: string;
  openedAt: string;
  openingCash: number;
  status: "Open" | "Closed";
  closedAt?: string;
  closedByName?: string;
  expectedCash?: number;
  countedCash?: number;
  difference?: number;
  handoverTo?: string;
  notes?: string;
  totals?: ShiftTotals | null;
}

export const billTone = (status: string) =>
  status === "Provisional" ? ("violet" as const) : status === "Final" ? ("amber" as const) : status === "Closed" ? ("green" as const) : statusTone(status);

export const payTone = (s: string) => (s === "Advance" ? ("blue" as const) : statusTone(s));
