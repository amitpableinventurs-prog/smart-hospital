/**
 * Stock document types. Shared by the browser (forms, lists) and the server
 * (lib/inventory.ts) so each workflow is described once. Keep free of
 * server-only imports.
 */

export const DOC_TYPES = [
  "requisition",
  "po",
  "grn",
  "purchase_return",
  "opening",
  "transfer",
  "issue",
  "patient_issue",
  "return",
  "write_off",
  "adjustment",
  "verification",
  "reservation",
] as const;
export type DocType = (typeof DOC_TYPES)[number];

/** How lines are entered. */
export type LineKind =
  | "request" // item + quantity (requisitions, reservations)
  | "order" // item + qty + rate + discount + GST (purchase orders)
  | "receipt" // item + batch + expiry + qty + rate + MRP (GRN, stock entry)
  | "pick" // item + quantity taken from store stock, batch optional (FEFO)
  | "adjust" // a specific batch + signed quantity
  | "return" // quantities against the lines of another document
  | "count"; // physical verification sheet

export const ISSUE_DEPARTMENTS = [
  "OT", "ICU", "Emergency", "Wards", "OPD", "Laboratory", "Radiology", "Pharmacy", "Dialysis", "CSSD", "Labour Room",
  "Housekeeping", "Kitchen", "Administration", "Maintenance", "Other",
] as const;
export const OPENING_REASONS = ["Opening balance", "Donation / free supply", "Found in physical count", "Other"] as const;
export const WRITE_OFF_REASONS = ["Expired", "Damaged / broken", "Lost / pilferage", "Quality rejected", "Recalled", "Other"] as const;
export const ADJUST_REASONS = ["Counting error", "Unit conversion correction", "System correction", "Other"] as const;
export const PURCHASE_RETURN_REASONS = ["Expired", "Near expiry", "Damaged in transit", "Wrong item / batch", "Quality issue", "Excess supply", "Other"] as const;
export const PRIORITIES = ["Normal", "Urgent"] as const;

export interface DocConfig {
  type: DocType;
  label: string;
  singular: string;
  prefix: string;
  lineKind: LineKind;
  description: string;
  statuses: readonly string[];
  /** Header fields this document uses. */
  store?: { label: string; required: boolean };
  toStore?: boolean;
  supplier?: boolean;
  patient?: boolean;
  department?: boolean;
  purpose?: boolean;
  reasons?: readonly string[];
  invoice?: boolean;
  expectedDate?: boolean;
  requiredBy?: boolean;
  priority?: boolean;
  /** Document types this one is raised against (returns). */
  against?: DocType[];
  /** Quantities are in purchase units (converted to issue units for stock). */
  purchaseUnits?: boolean;
  /** Has money totals worth showing in lists. */
  amounts?: boolean;
}

const POSTED = ["Posted", "Cancelled"] as const;

export const DOC_CONFIG: Record<DocType, DocConfig> = {
  requisition: {
    type: "requisition", label: "Purchase Requisitions", singular: "Purchase Requisition", prefix: "PR", lineKind: "request",
    description: "Departments request items to be purchased; approved requisitions become purchase orders.",
    statuses: ["Pending Approval", "Approved", "Rejected", "Ordered", "Closed"],
    store: { label: "For store", required: true }, department: true, requiredBy: true, priority: true, purchaseUnits: true,
  },
  po: {
    type: "po", label: "Purchase Orders", singular: "Purchase Order", prefix: "PO", lineKind: "order",
    description: "Orders placed with suppliers. Approved POs are received through GRNs.",
    statuses: ["Pending Approval", "Approved", "Partially Received", "Received", "Closed", "Cancelled"],
    supplier: true, store: { label: "Deliver to", required: true }, expectedDate: true, purchaseUnits: true, amounts: true,
  },
  grn: {
    type: "grn", label: "Goods Receipts", singular: "Goods Receipt Note", prefix: "GRN", lineKind: "receipt",
    description: "Receive supplier goods batch-wise into a store and post the supplier's invoice.",
    statuses: POSTED, supplier: true, store: { label: "Receive into", required: true }, invoice: true, purchaseUnits: true, amounts: true,
  },
  purchase_return: {
    type: "purchase_return", label: "Purchase Returns", singular: "Purchase Return", prefix: "PRT", lineKind: "return",
    description: "Return goods from a GRN to the supplier; the value is deducted from the supplier's dues.",
    statuses: POSTED, against: ["grn"], reasons: PURCHASE_RETURN_REASONS, purchaseUnits: true, amounts: true,
  },
  opening: {
    type: "opening", label: "Stock Entries", singular: "Stock Entry", prefix: "OST", lineKind: "receipt",
    description: "Bring stock into a store without a purchase: opening balances, donations, found stock.",
    statuses: POSTED, store: { label: "Store", required: true }, reasons: OPENING_REASONS,
  },
  transfer: {
    type: "transfer", label: "Stock Transfers", singular: "Stock Transfer", prefix: "TRF", lineKind: "pick",
    description: "Move stock between stores, e.g. Main Store → Pharmacy, OT, ICU or a ward.",
    statuses: POSTED, store: { label: "From store", required: true }, toStore: true,
  },
  issue: {
    type: "issue", label: "Department Issues", singular: "Department Issue", prefix: "ISS", lineKind: "pick",
    description: "Issue stock to a department for consumption (charged to that department).",
    statuses: POSTED, store: { label: "From store", required: true }, department: true,
  },
  patient_issue: {
    type: "patient_issue", label: "Patient Issues", singular: "Patient Issue", prefix: "PIS", lineKind: "pick",
    description: "Issue medicines and consumables to a patient, optionally adding them to the patient's bill.",
    statuses: POSTED, store: { label: "From store", required: true }, patient: true, amounts: true,
  },
  return: {
    type: "return", label: "Stock Returns", singular: "Stock Return", prefix: "RTN", lineKind: "return",
    description: "Return unused stock from a department issue, patient issue or transfer back to the store.",
    statuses: POSTED, against: ["issue", "patient_issue", "transfer"],
  },
  write_off: {
    type: "write_off", label: "Damaged / Expired Stock", singular: "Write-off", prefix: "WOF", lineKind: "adjust",
    description: "Remove damaged, expired or lost stock from a store.",
    statuses: POSTED, store: { label: "Store", required: true }, reasons: WRITE_OFF_REASONS,
  },
  adjustment: {
    type: "adjustment", label: "Stock Adjustments", singular: "Stock Adjustment", prefix: "ADJ", lineKind: "adjust",
    description: "Correct batch quantities up or down with a reason.",
    statuses: POSTED, store: { label: "Store", required: true }, reasons: ADJUST_REASONS,
  },
  verification: {
    type: "verification", label: "Physical Verifications", singular: "Physical Verification", prefix: "PSV", lineKind: "count",
    description: "Count a store's stock against the system and post the differences.",
    statuses: ["Counting", "Posted", "Cancelled"], store: { label: "Store", required: true },
  },
  reservation: {
    type: "reservation", label: "Stock Reservations", singular: "Stock Reservation", prefix: "RSV", lineKind: "request",
    description: "Hold stock for a patient, surgery or department so it is not issued elsewhere.",
    statuses: ["Active", "Consumed", "Released"], store: { label: "Store", required: true }, patient: true, purpose: true, requiredBy: true,
  },
};

export function isDocType(v: unknown): v is DocType {
  return typeof v === "string" && (DOC_TYPES as readonly string[]).includes(v);
}
