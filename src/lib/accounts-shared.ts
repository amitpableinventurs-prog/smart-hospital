/**
 * Accounting constants shared by the browser and the server (Marg / Tally
 * style double-entry books). Keep free of server-only imports.
 */

export const VOUCHER_TYPES = ["Receipt", "Payment", "Contra", "Journal", "Sales", "Purchase", "Credit Note", "Debit Note"] as const;
export type VoucherType = (typeof VOUCHER_TYPES)[number];

/** Short prefixes for manually entered voucher numbers. */
export const VOUCHER_PREFIX: Record<VoucherType, string> = {
  Receipt: "RV",
  Payment: "PV",
  Contra: "CV",
  Journal: "JV",
  Sales: "SV",
  Purchase: "PUV",
  "Credit Note": "CN",
  "Debit Note": "DN",
};

export const NATURES = ["Assets", "Liabilities", "Income", "Expenses"] as const;
export type Nature = (typeof NATURES)[number];

/** Where a group's ledgers appear in the Profit & Loss account. */
export type PlSection = "trading" | "indirect";

export interface GroupSeed {
  key: string;
  name: string;
  nature: Nature;
  parent?: string;
  pl?: PlSection;
}

/** Fixed primary groups and the usual sub-groups, created on first use. */
export const GROUP_SEEDS: GroupSeed[] = [
  { key: "capital", name: "Capital Account", nature: "Liabilities" },
  { key: "loans", name: "Loans (Liability)", nature: "Liabilities" },
  { key: "current_liabilities", name: "Current Liabilities", nature: "Liabilities" },
  { key: "suspense", name: "Suspense Account", nature: "Liabilities" },
  { key: "fixed_assets", name: "Fixed Assets", nature: "Assets" },
  { key: "investments", name: "Investments", nature: "Assets" },
  { key: "current_assets", name: "Current Assets", nature: "Assets" },
  { key: "sales", name: "Sales Accounts", nature: "Income", pl: "trading" },
  { key: "direct_income", name: "Direct Incomes", nature: "Income", pl: "trading" },
  { key: "indirect_income", name: "Indirect Incomes", nature: "Income", pl: "indirect" },
  { key: "purchases", name: "Purchase Accounts", nature: "Expenses", pl: "trading" },
  { key: "direct_expenses", name: "Direct Expenses", nature: "Expenses", pl: "trading" },
  { key: "indirect_expenses", name: "Indirect Expenses", nature: "Expenses", pl: "indirect" },

  { key: "reserves", name: "Reserves & Surplus", nature: "Liabilities", parent: "capital" },
  { key: "secured_loans", name: "Secured Loans", nature: "Liabilities", parent: "loans" },
  { key: "unsecured_loans", name: "Unsecured Loans", nature: "Liabilities", parent: "loans" },
  { key: "bank_od", name: "Bank OD Accounts", nature: "Liabilities", parent: "loans" },
  { key: "duties_taxes", name: "Duties & Taxes", nature: "Liabilities", parent: "current_liabilities" },
  { key: "creditors", name: "Sundry Creditors", nature: "Liabilities", parent: "current_liabilities" },
  { key: "provisions", name: "Provisions", nature: "Liabilities", parent: "current_liabilities" },
  { key: "cash", name: "Cash-in-Hand", nature: "Assets", parent: "current_assets" },
  { key: "bank", name: "Bank Accounts", nature: "Assets", parent: "current_assets" },
  { key: "debtors", name: "Sundry Debtors", nature: "Assets", parent: "current_assets" },
  { key: "deposits", name: "Deposits (Asset)", nature: "Assets", parent: "current_assets" },
  { key: "loans_advances", name: "Loans & Advances (Asset)", nature: "Assets", parent: "current_assets" },
];

export interface LedgerSeed {
  key: string;
  name: string;
  group: string;
}

/** Ledgers the automatic postings use. Party and income-head ledgers are added as they are needed. */
export const LEDGER_SEEDS: LedgerSeed[] = [
  { key: "cash", name: "Cash", group: "cash" },
  { key: "bank", name: "Bank Account", group: "bank" },
  { key: "capital", name: "Owner's Capital", group: "capital" },
  { key: "patients", name: "Patient Receivables", group: "debtors" },
  { key: "output_cgst", name: "Output CGST", group: "duties_taxes" },
  { key: "output_sgst", name: "Output SGST", group: "duties_taxes" },
  { key: "output_igst", name: "Output IGST", group: "duties_taxes" },
  { key: "input_cgst", name: "Input CGST", group: "duties_taxes" },
  { key: "input_sgst", name: "Input SGST", group: "duties_taxes" },
  { key: "input_igst", name: "Input IGST", group: "duties_taxes" },
  { key: "pharmacy_sales", name: "Pharmacy Sales", group: "sales" },
  { key: "lab_income", name: "Laboratory Income", group: "sales" },
  { key: "ambulance_income", name: "Ambulance Income", group: "sales" },
  { key: "pharmacy_purchases", name: "Purchases - Pharmacy", group: "purchases" },
  { key: "store_purchases", name: "Purchases - Stores", group: "purchases" },
  { key: "doctor_fees", name: "Doctor Fees & Professional Charges", group: "direct_expenses" },
  { key: "salaries", name: "Salaries & Wages", group: "indirect_expenses" },
  { key: "employer_contribution", name: "Employer PF / ESI Contribution", group: "indirect_expenses" },
  { key: "tpa_deductions", name: "Insurance / TPA Deductions", group: "indirect_expenses" },
  { key: "round_off", name: "Round Off", group: "indirect_expenses" },
  { key: "pf_payable", name: "PF Payable", group: "duties_taxes" },
  { key: "esi_payable", name: "ESI Payable", group: "duties_taxes" },
  { key: "pt_payable", name: "Professional Tax Payable", group: "duties_taxes" },
  { key: "tds_payable", name: "TDS Payable (Salary)", group: "duties_taxes" },
  { key: "staff_advances", name: "Staff Advances & Loans", group: "loans_advances" },
  { key: "payer_receivables", name: "Corporate / TPA Receivables", group: "debtors" },
];

/** Payment modes used across the modules, mapped to a cash or bank ledger in Accounts settings. */
export const MONEY_MODES = ["Cash", "Card", "UPI", "Bank Transfer", "Cheque"] as const;

/** GST state codes (first two digits of a GSTIN, and the "place of supply"). */
export const GST_STATES: Record<string, string> = {
  "01": "Jammu & Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "26": "Dadra & Nagar Haveli and Daman & Diu",
  "27": "Maharashtra",
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshadweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman & Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh",
  "38": "Ladakh",
  "97": "Other Territory",
};

export const GST_STATE_OPTIONS = Object.entries(GST_STATES).map(([code, name]) => `${code} - ${name}`);

export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** "27" from a GSTIN or a "27 - Maharashtra" option; "" when unknown. */
export function stateCodeOf(v: unknown): string {
  const s = typeof v === "string" ? v.trim().toUpperCase() : "";
  const code = s.slice(0, 2);
  return /^\d{2}$/.test(code) && GST_STATES[code] ? code : "";
}

/** Indian financial year of a date, e.g. "2026-27". */
export function financialYear(d: Date) {
  const y = d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
}

/** 1 April of the financial year containing `d`, as "YYYY-MM-DD". */
export function fyStart(d = new Date()) {
  return `${financialYear(d).slice(0, 4)}-04-01`;
}

/** Display a signed balance (debit positive) Tally style: "1,200.00 Dr". */
export function drCr(n: number) {
  const abs = Math.abs(Math.round(n * 100) / 100);
  if (abs === 0) return "0.00";
  return `${abs.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${n > 0 ? "Dr" : "Cr"}`;
}
