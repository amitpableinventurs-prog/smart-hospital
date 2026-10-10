export const REPORT_TABS = [
  { key: "daybook", label: "Day Book" },
  { key: "sales-register", label: "Sales Register" },
  { key: "stock", label: "Stock" },
  { key: "expiry", label: "Expiry" },
  { key: "outstanding", label: "Outstanding" },
] as const;
export type ReportKey = (typeof REPORT_TABS)[number]["key"];
