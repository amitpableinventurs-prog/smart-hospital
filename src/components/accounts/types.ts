export interface VoucherEntry {
  ledgerId: string;
  ledger: string;
  dr: number;
  cr: number;
  note: string;
}

export interface Voucher {
  id: string;
  code: string;
  type: string;
  date: string;
  amount: number;
  narration: string;
  refNo: string;
  auto: boolean;
  status: "Active" | "Cancelled";
  source: { kind: string; label: string; code: string; href: string | null } | null;
  entries: VoucherEntry[];
  createdByName: string | null;
  createdAt: string | null;
  cancelReason: string | null;
  cancelledByName: string | null;
}

export const VOUCHER_TONE: Record<string, "blue" | "green" | "amber" | "red" | "slate" | "violet"> = {
  Receipt: "green",
  Payment: "red",
  Contra: "violet",
  Journal: "slate",
  Sales: "blue",
  Purchase: "amber",
  "Credit Note": "amber",
  "Debit Note": "amber",
};

/** Tally-style shortcuts for the voucher types. */
export const VOUCHER_KEYS: Record<string, string> = {
  Contra: "F4",
  Payment: "F5",
  Receipt: "F6",
  Journal: "F7",
  Sales: "F8",
  Purchase: "F9",
};
