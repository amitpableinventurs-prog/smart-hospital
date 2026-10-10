/**
 * Bill arithmetic shared by the POS screen (live totals) and the API
 * (authoritative totals). Indian pharmacy convention: MRP includes GST.
 */

export const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface SaleLineInput {
  qty: number;
  mrp: number;
  discountPct: number;
  gstRate: number;
}

export function saleLine({ qty, mrp, discountPct, gstRate }: SaleLineInput) {
  const gross = r2(qty * mrp);
  const discount = r2((gross * discountPct) / 100);
  const amount = r2(gross - discount);
  const taxable = r2(amount / (1 + gstRate / 100));
  const gst = r2(amount - taxable);
  return { gross, discount, taxable, gst, amount };
}

export function saleTotals(lines: ReturnType<typeof saleLine>[]) {
  const sum = (k: keyof ReturnType<typeof saleLine>) => r2(lines.reduce((s, l) => s + l[k], 0));
  const amount = sum("amount");
  const netAmount = Math.round(amount);
  return {
    grossTotal: sum("gross"),
    discountTotal: sum("discount"),
    taxableTotal: sum("taxable"),
    gstTotal: sum("gst"),
    roundOff: r2(netAmount - amount),
    netAmount,
  };
}

export interface PurchaseLineInput {
  qty: number;
  purchaseRate: number;
  discountPct: number;
  gstRate: number;
}

/** Purchase rate excludes GST; GST is added on the discounted value. */
export function purchaseLine({ qty, purchaseRate, discountPct, gstRate }: PurchaseLineInput) {
  const base = r2(qty * purchaseRate);
  const taxable = r2(base - (base * discountPct) / 100);
  const gst = r2((taxable * gstRate) / 100);
  return { taxable, gst, amount: r2(taxable + gst) };
}

export function purchaseTotals(lines: ReturnType<typeof purchaseLine>[]) {
  const taxableTotal = r2(lines.reduce((s, l) => s + l.taxable, 0));
  const gstTotal = r2(lines.reduce((s, l) => s + l.gst, 0));
  const amount = r2(taxableTotal + gstTotal);
  const netAmount = Math.round(amount);
  return { taxableTotal, gstTotal, roundOff: r2(netAmount - amount), netAmount };
}

export function paymentStatus(net: number, paid: number) {
  if (paid >= net) return "Paid" as const;
  if (paid > 0) return "Partially Paid" as const;
  return "Unpaid" as const;
}

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function belowHundred(n: number) {
  return n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ""}`;
}
function belowThousand(n: number) {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  return [h ? `${ONES[h]} Hundred` : "", rest ? belowHundred(rest) : ""].filter(Boolean).join(" ");
}

/** e.g. 125430 -> "Rupees One Lakh Twenty Five Thousand Four Hundred Thirty Only" */
export function amountInWords(amount: number) {
  let n = Math.round(Math.abs(amount));
  if (n === 0) return "Rupees Zero Only";
  const parts: string[] = [];
  const crore = Math.floor(n / 1e7);
  n %= 1e7;
  const lakh = Math.floor(n / 1e5);
  n %= 1e5;
  const thousand = Math.floor(n / 1e3);
  n %= 1e3;
  if (crore) parts.push(`${belowThousand(crore)} Crore`);
  if (lakh) parts.push(`${belowHundred(lakh)} Lakh`);
  if (thousand) parts.push(`${belowHundred(thousand)} Thousand`);
  if (n) parts.push(belowThousand(n));
  return `Rupees ${parts.join(" ")} Only`;
}
