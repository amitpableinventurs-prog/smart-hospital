import "server-only";
import type { Types } from "mongoose";
import { r2 } from "./billing-math";
import type { SessionUser } from "./session";
import { nextCode } from "@/models/Counter";
import { Bill } from "@/models/billing";
import { CLAIM_DOCUMENTS, Claim, PreAuth, REQUIRED_DOCUMENTS, type ClaimDoc, type PreAuthDoc } from "@/models/insurance";
import { getRecordModel } from "@/models/records";

/**
 * Raising the insurance claim when an insurance bill is finalised. Kept apart
 * from lib/insurance.ts (which calls into Billing) so Billing can use it without
 * a circular import.
 */

type Doc = Record<string, unknown> & { _id: Types.ObjectId };

const DAY = 86_400_000;
/** Claims still with the hospital or the insurer, whose amount follows the bill. */
export const OPEN_CLAIM_STATUSES: ClaimDoc["status"][] = ["Pending Submission", "Submitted", "Under Review", "Query Raised"];
/** Pre-auths holding a sanction. */
const APPROVED: PreAuthDoc["status"][] = ["Approved", "Enhancement Requested"];

const money = (n: number) => `₹${r2(n).toLocaleString("en-IN")}`;

export function claimOutstanding(c: { claimAmount: number; settledAmount?: number | null; tdsAmount?: number | null; deductionAmount?: number | null; patientAmount?: number | null }) {
  return r2(Math.max(0, c.claimAmount - (c.settledAmount ?? 0) - (c.tdsAmount ?? 0) - (c.deductionAmount ?? 0) - (c.patientAmount ?? 0)));
}

export function documentChecklist(withPreauth: boolean) {
  return CLAIM_DOCUMENTS.map((name) => ({ name, required: REQUIRED_DOCUMENTS.has(name) || (withPreauth && name === "Pre-authorisation approval letter"), received: false }));
}

/**
 * Payer fields for a new IPD bill when the admission already has an approved
 * cashless pre-authorisation (null otherwise).
 */
export async function approvedPreauthPayer(admissionId: unknown) {
  const pre = await PreAuth.findOne({ admission: admissionId as Types.ObjectId, status: { $in: APPROVED }, approvedAmount: { $gt: 0 } }).sort({ createdAt: -1 }).lean();
  if (!pre) return null;
  return { id: pre._id, code: pre.code, payer: { payerType: "Insurance", insuranceProvider: String(pre.insurer), policyNo: pre.policyNumber ?? "", tpaName: pre.tpaName ?? "", authNo: pre.authNo ?? "", payerLimit: pre.approvedAmount } };
}

/** Remember which bill carries the pre-auth's approval. */
export async function linkPreauthBill(preauthId: Types.ObjectId, bill: { _id: Types.ObjectId; code: string }, user: Pick<SessionUser, "name">) {
  await PreAuth.updateOne(
    { _id: preauthId },
    { $set: { bill: bill._id, billCode: bill.code, billSyncedAt: new Date() }, $push: { events: { at: new Date(), action: "Billing", byName: user.name, note: `IPD bill ${bill.code} opened with the approved limit` } } }
  );
}

interface FinalBill {
  _id: Types.ObjectId;
  code: string;
  billDate: Date;
  patient: Types.ObjectId;
  patientName: string;
  patientCode?: string | null;
  insuranceProvider?: Types.ObjectId | null;
  payerName?: string | null;
  tpaName?: string | null;
  policyNo?: string | null;
  authNo?: string | null;
  payerLimit?: number | null;
  payerShare: number;
  admission?: Types.ObjectId | null;
  admissionCode?: string | null;
  admissionDate?: Date | null;
  dischargeDate?: Date | null;
  claim?: Types.ObjectId | null;
}

/**
 * Create (or re-price) the claim for a finalised insurance bill and link the
 * admission's approved pre-authorisation. Returns a note for the bill's audit entry.
 */
export async function raiseClaimForBill(bill: FinalBill, user: Pick<SessionUser, "id" | "name">): Promise<string | null> {
  if (!bill.insuranceProvider || !(bill.payerShare > 0)) return null;
  // A cancelled claim does not count: finalising again raises a fresh one.
  const existing = await Claim.findOne({ bill: bill._id, status: { $ne: "Cancelled" } }).sort({ createdAt: -1 });
  if (existing) {
    if (!OPEN_CLAIM_STATUSES.includes(existing.status)) return null;
    existing.claimAmount = bill.payerShare;
    if (typeof bill.payerLimit === "number") existing.approvedAmount = Math.min(bill.payerLimit, bill.payerShare);
    existing.outstanding = claimOutstanding(existing);
    existing.events.push({ at: new Date(), action: "Re-priced", byName: user.name, note: `Bill ${bill.code} finalised again at ${money(bill.payerShare)}` });
    await existing.save();
    if (String(bill.claim ?? "") !== String(existing._id)) await Bill.updateOne({ _id: bill._id }, { $set: { claim: existing._id, claimCode: existing.code } });
    return `claim ${existing.code} updated to ${money(bill.payerShare)}`;
  }

  const preauth = bill.admission
    ? await PreAuth.findOne({ admission: bill.admission, status: { $in: APPROVED } }).sort({ createdAt: -1 })
    : null;
  const Policies = getRecordModel("insurance", "policies")!;
  const Providers = getRecordModel("insurance", "providers")!;
  const policy = preauth?.policy
    ? await Policies.findById(preauth.policy).lean<Doc>()
    : await Policies.findOne({ patient: bill.patient, insurer: bill.insuranceProvider, policyNumber: bill.policyNo }).lean<Doc>();
  const insurer = await Providers.findById(bill.insuranceProvider).select("name paymentTermsDays").lean<Doc>();
  const tpa = (preauth?.tpa ?? policy?.tpa) ? await Providers.findById(preauth?.tpa ?? policy?.tpa).select("name").lean<Doc>() : null;

  const claimAmount = r2(bill.payerShare);
  const now = new Date();
  const claim = await Claim.create({
    code: await nextCode("CLM"),
    claimType: "Cashless",
    patient: bill.patient, patientName: bill.patientName, patientCode: bill.patientCode ?? undefined,
    provider: bill.insuranceProvider, providerName: String(insurer?.name ?? bill.payerName ?? ""),
    tpa: tpa?._id, tpaName: (tpa?.name as string | undefined) ?? bill.tpaName ?? undefined,
    policy: policy?._id, policyNumber: bill.policyNo ?? String(policy?.policyNumber ?? "—"), memberId: (policy?.memberId as string | undefined) ?? preauth?.memberId ?? undefined,
    preauth: preauth?._id, preauthCode: preauth?.code, authNo: bill.authNo ?? preauth?.authNo ?? undefined,
    bill: bill._id, billCode: bill.code, billDate: bill.billDate,
    admissionCode: bill.admissionCode ?? undefined, admissionDate: bill.admissionDate ?? undefined, dischargeDate: bill.dischargeDate ?? undefined,
    diagnosis: preauth?.diagnosis,
    claimAmount, approvedAmount: typeof bill.payerLimit === "number" ? Math.min(bill.payerLimit, claimAmount) : undefined, outstanding: claimAmount,
    // Due date is counted from submission; until then it is provisional from the bill date.
    dueDate: new Date(now.getTime() + Number(insurer?.paymentTermsDays ?? 30) * DAY),
    documents: documentChecklist(!!preauth),
    status: "Pending Submission",
    remarks: `Final bill ${bill.code}${bill.tpaName ? ` via TPA ${bill.tpaName}` : ""}${bill.authNo ? `, pre-auth ${bill.authNo}` : ""}`.slice(0, 1000),
    events: [{ at: now, action: "Raised", byName: user.name, note: `From final bill ${bill.code} for ${money(claimAmount)}` }],
    createdBy: user.id, updatedBy: user.id, createdByName: user.name,
  });
  await Bill.updateOne({ _id: bill._id }, { $set: { claim: claim._id, claimCode: claim.code } });
  if (preauth) {
    preauth.status = "Claimed";
    preauth.claim = claim._id;
    preauth.claimCode = claim.code;
    preauth.events.push({ at: now, action: "Claimed", byName: user.name, note: `Claim ${claim.code} raised from bill ${bill.code}` });
    await preauth.save();
  }
  return `insurance claim ${claim.code} raised for ${money(claimAmount)}${preauth ? ` (pre-auth ${preauth.code})` : ""}`;
}
