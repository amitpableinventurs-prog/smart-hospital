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

export interface ChargeLineInput {
  qty: number;
  rate: number;
  discountPct: number;
  gstRate: number;
}

/**
 * Hospital bill: GST (if any) is added on top of each charge, and the
 * bill-level discount is spread over the charges in proportion to their value
 * before tax, so the GST summary stays correct.
 */
export function hospitalBill(lines: ChargeLineInput[], billDiscount: number) {
  const pre = lines.map((l) => {
    const gross = r2(l.qty * l.rate);
    const lineDiscount = r2((gross * Math.min(100, Math.max(0, l.discountPct))) / 100);
    return { gross, lineDiscount, net: r2(gross - lineDiscount) };
  });
  const base = r2(pre.reduce((s, p) => s + p.net, 0));
  const wanted = Math.min(Math.max(0, r2(billDiscount || 0)), base);
  const last = pre.findLastIndex((p) => p.net > 0);
  let given = 0;
  const out = pre.map((p, i) => {
    let share = 0;
    if (wanted > 0 && p.net > 0) share = Math.min(p.net, i === last ? r2(wanted - given) : r2((wanted * p.net) / base));
    given = r2(given + share);
    const taxable = r2(p.net - share);
    const gst = r2((taxable * lines[i].gstRate) / 100);
    return { gross: p.gross, discount: r2(p.lineDiscount + share), taxable, gst, amount: r2(taxable + gst) };
  });
  const sum = (k: keyof (typeof out)[number]) => r2(out.reduce((s, l) => s + l[k], 0));
  const total = sum("amount");
  const netAmount = Math.round(total);
  return {
    lines: out,
    totals: {
      grossAmount: sum("gross"),
      lineDiscount: r2(pre.reduce((s, p) => s + p.lineDiscount, 0)),
      billDiscount: given,
      discountAmount: sum("discount"),
      taxableAmount: sum("taxable"),
      gstAmount: sum("gst"),
      roundOff: r2(netAmount - total),
      netAmount,
    },
  };
}

/** How much of the net bill a corporate / insurance payer covers; the rest is the patient's. */
export function payerSplit(opts: { net: number; payerType: string; coveragePct?: number | null; payerLimit?: number | null; movedToPatient?: number | null }) {
  const { net, payerType } = opts;
  let payer = 0;
  if (payerType === "Corporate") payer = r2((net * Math.min(100, Math.max(0, opts.coveragePct ?? 100))) / 100);
  else if (payerType === "Insurance") payer = net;
  if (payerType !== "Self" && typeof opts.payerLimit === "number" && opts.payerLimit >= 0) payer = Math.min(payer, opts.payerLimit);
  payer = r2(Math.max(0, payer - (opts.movedToPatient ?? 0)));
  return { payerShare: payer, patientShare: r2(net - payer) };
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
