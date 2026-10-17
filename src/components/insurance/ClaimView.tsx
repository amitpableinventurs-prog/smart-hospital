"use client";

import { ArrowLeft, Ban, CheckCircle2, Eye, FileQuestion, IndianRupee, MessageSquareReply, NotebookPen, Plus, Send, XCircle } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { api } from "@/lib/client";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { useApiQuery } from "@/lib/useApi";
import { FormModal, numOrUndefined, type ModalField, type ModalValues } from "../FormModal";
import { Alert, Badge, Button, Card, CardHeader, EmptyState, ErrorState, Spinner, cx, useToast } from "../ui";
import { insuranceTone } from "./InsuranceSection";
import { Figure, Info, Timeline, type TimelineEvent } from "../DetailBits";

interface Claim {
  id: string;
  code: string;
  claimType: string;
  status: string;
  patient: string;
  patientName?: string;
  patientCode?: string;
  providerName?: string;
  tpaName?: string;
  policyNumber: string;
  memberId?: string;
  preauth?: string;
  preauthCode?: string;
  authNo?: string;
  billCode?: string;
  billDate?: string;
  admissionCode?: string;
  admissionDate?: string;
  dischargeDate?: string;
  diagnosis?: string;
  claimAmount: number;
  approvedAmount?: number;
  settledAmount: number;
  tdsAmount: number;
  deductionAmount: number;
  patientAmount: number;
  outstanding: number;
  submittedDate?: string;
  dueDate?: string;
  settledDate?: string;
  rejectReason?: string;
  remarks?: string;
  documents: { name: string; required?: boolean; received: boolean; receivedAt?: string; byName?: string }[];
  queries: { _id: string; raisedAt: string; query: string; response?: string; respondedAt?: string; respondedByName?: string }[];
  settlements: { _id: string; at: string; amount: number; tds: number; deduction: number; toPatient: number; mode?: string; utr?: string; reason?: string; receiptCode?: string; byName?: string }[];
  events: TimelineEvent[];
  createdAt: string;
  createdByName?: string;
  bill: { id: string; code: string; status: string; netAmount: number; payerShare: number; payerPaid: number; payerDue: number; payerWriteOff: number; patientDue: number } | null;
}

type Dialog = { title: string; description?: string; fields: ModalField[]; confirm: string; danger?: boolean; size?: "md" | "lg"; body: (v: ModalValues) => Record<string, unknown>; msg: string; preview?: (v: ModalValues) => ReactNode };

const today = () => new Date().toISOString().slice(0, 10);

export function ClaimView({ id }: { id: string }) {
  const toast = useToast();
  const q = useApiQuery<Claim>(`/api/insurance/claims/${id}`);
  const [latest, setLatest] = useState<Claim | null>(null);
  const claim = latest?.id === id ? latest : q.data;
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const back = <Link href="/m/insurance?tab=claims" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="size-4" /> Back to claims</Link>;
  if (q.error) return <>{back}<Card>{q.status === 404 ? <EmptyState title="Claim not found" /> : <ErrorState message={q.error} onRetry={q.reload} />}</Card></>;
  if (!claim) return <>{back}<Spinner label="Loading claim…" /></>;

  const run = async (body: Record<string, unknown>, msg: string) => {
    const { data } = await api<Claim>(`/api/insurance/claims/${id}/action`, { method: "POST", body });
    setLatest(data);
    setDialog(null);
    toast(msg);
  };
  const quick = async (key: string, body: Record<string, unknown>, msg: string) => {
    setBusy(key);
    try {
      await run(body, msg);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  };

  const s = claim.status;
  const payer = claim.tpaName ?? claim.providerName ?? "the insurer";
  const missing = claim.documents.filter((d) => d.required && !d.received);
  const editableDocs = ["Pending Submission", "Submitted", "Under Review", "Query Raised", "Approved", "Partially Settled"].includes(s);
  const settleable = ["Submitted", "Under Review", "Approved", "Partially Settled"].includes(s);

  const settleDialog = (): Dialog => ({
    title: "Record settlement",
    description: `Outstanding ${formatMoney(claim.outstanding)}${claim.bill ? ` · posted to bill ${claim.bill.code}` : ""}`,
    size: "lg",
    confirm: "Record settlement",
    msg: "Settlement recorded",
    fields: [
      { name: "amount", label: "Amount received", type: "number", min: 0, defaultValue: String(claim.approvedAmount && claim.approvedAmount < claim.outstanding ? claim.approvedAmount : claim.outstanding) },
      { name: "date", label: "Received on", type: "date", required: true, defaultValue: today() },
      { name: "mode", label: "Received by", type: "select", options: ["Bank Transfer", "Cheque"], defaultValue: "Bank Transfer" },
      { name: "utr", label: "UTR / cheque no.", maxLength: 60 },
      { name: "tds", label: "TDS deducted by insurer", type: "number", min: 0, hint: "Claimed back as a tax credit" },
      { name: "deduction", label: "Deducted (hospital writes off)", type: "number", min: 0, hint: "e.g. tariff difference, discounts" },
      { name: "toPatient", label: "Disallowed (patient pays)", type: "number", min: 0, hint: "Non-payables, co-pay, room-rent proportion; added to the patient's due" },
      { name: "reason", label: "Insurer's deduction reasons", type: "textarea", maxLength: 300, wide: true },
    ],
    preview: (v) => {
      const total = ["amount", "tds", "deduction", "toPatient"].reduce((t, k) => t + (numOrUndefined(v[k]) ?? 0), 0);
      const left = Math.round((claim.outstanding - total) * 100) / 100;
      return <p className={cx("text-sm", left < 0 ? "font-medium text-red-600" : "text-slate-600")}>Accounted {formatMoney(total)} of {formatMoney(claim.outstanding)} · {left < 0 ? `${formatMoney(-left)} too much` : left === 0 ? "claim will be settled in full" : `${formatMoney(left)} will stay outstanding`}</p>;
    },
    body: (v) => ({ action: "settle", amount: numOrUndefined(v.amount) ?? 0, date: v.date, mode: v.mode, utr: v.utr, tds: numOrUndefined(v.tds) ?? 0, deduction: numOrUndefined(v.deduction) ?? 0, toPatient: numOrUndefined(v.toPatient) ?? 0, reason: v.reason }),
  });

  const actions: ReactNode[] = [];
  if (s === "Pending Submission") {
    actions.push(<Button key="submit" disabled={missing.length > 0} title={missing.length ? `Collect: ${missing.map((d) => d.name).join(", ")}` : undefined} onClick={() => setDialog({
      title: `Submit to ${payer}`, confirm: "Mark submitted", msg: "Claim submitted",
      fields: [{ name: "submittedDate", label: "Submitted on", type: "date", required: true, defaultValue: today() }, { name: "reference", label: "Courier docket / portal reference", maxLength: 80 }],
      body: (v) => ({ action: "submit", submittedDate: v.submittedDate, reference: v.reference }),
    })}><Send className="size-4" /> Submit claim</Button>);
  }
  if (s === "Submitted") actions.push(<Button key="review" variant="secondary" loading={busy === "review"} onClick={() => quick("review", { action: "review" }, "Marked under review")}><Eye className="size-4" /> Under review</Button>);
  if (["Submitted", "Under Review", "Query Raised"].includes(s)) {
    actions.push(<Button key="approve" variant="secondary" onClick={() => setDialog({
      title: "Record approval", description: `Claimed ${formatMoney(claim.claimAmount)}`, confirm: "Record approval", msg: "Approval recorded",
      fields: [{ name: "approvedAmount", label: "Amount approved", type: "number", required: true, min: 0, defaultValue: String(claim.claimAmount) }],
      body: (v) => ({ action: "approve", approvedAmount: numOrUndefined(v.approvedAmount) }),
    })}><CheckCircle2 className="size-4" /> Approved</Button>);
  }
  if (settleable) actions.push(<Button key="settle" onClick={() => setDialog(settleDialog())}><IndianRupee className="size-4" /> Record settlement</Button>);
  if (["Submitted", "Under Review", "Approved"].includes(s)) {
    actions.push(<Button key="query" variant="secondary" onClick={() => setDialog({
      title: "Record insurer query", confirm: "Record query", msg: "Query recorded",
      fields: [{ name: "query", label: "Query / documents asked for", type: "textarea", required: true, maxLength: 1000 }, { name: "raisedOn", label: "Raised on", type: "date", defaultValue: today() }],
      body: (v) => ({ action: "query", query: v.query, raisedOn: v.raisedOn }),
    })}><FileQuestion className="size-4" /> Query</Button>);
  }
  if (s === "Query Raised") {
    actions.push(<Button key="respond" onClick={() => setDialog({
      title: "Reply to query", description: [...claim.queries].reverse().find((x) => !x.response)?.query, confirm: "Save reply", msg: "Reply recorded",
      fields: [{ name: "response", label: "Reply / documents sent", type: "textarea", required: true, maxLength: 1000 }], body: (v) => ({ action: "respond", response: v.response }),
    })}><MessageSquareReply className="size-4" /> Reply sent</Button>);
  }
  if (["Submitted", "Under Review", "Query Raised", "Approved"].includes(s)) {
    actions.push(<Button key="reject" variant="secondary" className="text-red-600" onClick={() => setDialog({
      title: "Record rejection", confirm: "Record rejection", danger: true, msg: "Rejection recorded",
      fields: [
        { name: "reason", label: "Insurer's reason", type: "textarea", required: true, maxLength: 500 },
        { name: "moveToPatient", label: `Collect the ${formatMoney(claim.outstanding)} outstanding from the patient`, type: "checkbox", hint: claim.bill ? `Moves it to the patient's due on bill ${claim.bill.code}` : "Recorded on the claim" },
      ],
      body: (v) => ({ action: "reject", reason: v.reason, moveToPatient: v.moveToPatient === true }),
    })}><XCircle className="size-4" /> Rejected</Button>);
  }
  if (s === "Pending Submission") {
    actions.push(<Button key="cancel" variant="secondary" className="text-red-600" onClick={() => setDialog({
      title: "Cancel claim?", description: "The bill is unlinked; finalising it again raises a fresh claim.", confirm: "Cancel claim", danger: true, msg: "Claim cancelled",
      fields: [{ name: "reason", label: "Reason", required: true, maxLength: 300 }], body: (v) => ({ action: "cancel", reason: v.reason }),
    })}><Ban className="size-4" /> Cancel</Button>);
  }
  actions.push(<Button key="note" variant="ghost" onClick={() => setDialog({ title: "Add note", confirm: "Add note", msg: "Note added", fields: [{ name: "note", label: "Note", type: "textarea", required: true, maxLength: 500 }], body: (v) => ({ action: "note", note: v.note }) })}><NotebookPen className="size-4" /> Note</Button>);

  return (
    <>
      {back}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-slate-900">Claim <span className="font-mono">{claim.code}</span></h1>
            <Badge tone={insuranceTone(s)}>{s}</Badge>
            <Badge tone="slate">{claim.claimType}</Badge>
          </div>
          <p className="mt-1 text-sm text-slate-500">{claim.patientName} ({claim.patientCode}) · {claim.providerName}{claim.tpaName ? ` via ${claim.tpaName}` : ""} · policy {claim.policyNumber}{claim.memberId ? ` / ${claim.memberId}` : ""}</p>
        </div>
        <div className="flex flex-wrap gap-2">{actions}</div>
      </div>

      {s === "Rejected" && <div className="mb-4"><Alert>Rejected: {claim.rejectReason}</Alert></div>}
      {s === "Pending Submission" && missing.length > 0 && <div className="mb-4"><Alert tone="amber">Collect before submitting: {missing.map((d) => d.name).join(", ")}.</Alert></div>}
      {claim.dueDate && claim.outstanding > 0 && settleable && new Date(claim.dueDate) < new Date() && <div className="mb-4"><Alert>Overdue since {formatDate(claim.dueDate)}. Follow up with {payer}.</Alert></div>}

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Figure label="Claimed" value={formatMoney(claim.claimAmount)} hint={claim.approvedAmount != null ? `Approved ${formatMoney(claim.approvedAmount)}` : undefined} />
        <Figure label="Received" value={formatMoney(claim.settledAmount)} tone={claim.settledAmount ? "green" : undefined} />
        <Figure label="TDS + deducted" value={formatMoney(claim.tdsAmount + claim.deductionAmount)} hint={`TDS ${formatMoney(claim.tdsAmount)}`} tone={claim.deductionAmount ? "amber" : undefined} />
        <Figure label="Moved to patient" value={formatMoney(claim.patientAmount)} />
        <Figure label="Outstanding" value={formatMoney(claim.outstanding)} hint={claim.dueDate ? `Due ${formatDate(claim.dueDate)}` : "Not submitted"} tone={claim.outstanding ? "red" : "green"} />
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Card>
            <CardHeader title="Document checklist" description="Required documents must be collected before submission" actions={editableDocs ? <Button variant="ghost" onClick={() => setDialog({ title: "Add document", confirm: "Add", msg: "Document added", fields: [{ name: "name", label: "Document", required: true, maxLength: 80 }, { name: "required", label: "Required for submission", type: "checkbox" }], body: (v) => ({ action: "add-document", name: v.name, required: v.required === true }) })}><Plus className="size-4" /> Add</Button> : undefined} />
            <ul className="divide-y divide-slate-100">
              {claim.documents.map((d) => (
                <li key={d.name} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                  <input type="checkbox" checked={d.received} disabled={!editableDocs || busy === d.name} onChange={(e) => quick(d.name, { action: "document", name: d.name, received: e.target.checked }, e.target.checked ? `${d.name} received` : `${d.name} unmarked`)} className="size-4 rounded border-slate-300 text-brand-600" aria-label={d.name} />
                  <span className={cx("flex-1", d.received ? "text-slate-900" : "text-slate-600")}>{d.name}{d.required && <span className="ml-1 text-xs text-red-600">required</span>}</span>
                  {d.received && <span className="text-xs text-slate-500">{formatDateTime(d.receivedAt)} · {d.byName}</span>}
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <CardHeader title="Settlements" description={claim.bill ? `Each settlement is posted to bill ${claim.bill.code} as a payer receipt` : undefined} />
            {claim.settlements.length === 0 ? <p className="px-5 py-4 text-sm text-slate-500">Nothing received yet.</p> : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-100 text-sm">
                  <thead><tr>{["Date", "Received", "TDS", "Deducted", "To patient", "UTR / cheque", "Bill receipt"].map((h) => <th key={h} className="whitespace-nowrap px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">{h}</th>)}</tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {claim.settlements.map((x) => (
                      <tr key={x._id} title={x.reason}>
                        <td className="whitespace-nowrap px-4 py-2">{formatDate(x.at)}<span className="block text-xs text-slate-500">{x.byName}</span></td>
                        <td className="px-4 py-2 tabular-nums">{formatMoney(x.amount)}</td>
                        <td className="px-4 py-2 tabular-nums">{formatMoney(x.tds)}</td>
                        <td className="px-4 py-2 tabular-nums">{formatMoney(x.deduction)}</td>
                        <td className="px-4 py-2 tabular-nums">{formatMoney(x.toPatient)}</td>
                        <td className="px-4 py-2">{x.utr ? `${x.mode ?? ""} ${x.utr}` : "—"}</td>
                        <td className="px-4 py-2 font-mono text-xs">{x.receiptCode ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          <Card>
            <CardHeader title="Queries" />
            {claim.queries.length === 0 ? <p className="px-5 py-4 text-sm text-slate-500">No queries.</p> : (
              <ul className="divide-y divide-slate-100">
                {claim.queries.map((x) => (
                  <li key={x._id} className="px-5 py-3 text-sm">
                    <p className="text-slate-900"><span className="text-xs text-slate-500">{formatDate(x.raisedAt)} · </span>{x.query}</p>
                    {x.response ? <p className="mt-1 text-slate-600"><span className="text-xs text-slate-500">Replied {formatDateTime(x.respondedAt)} by {x.respondedByName}: </span>{x.response}</p> : <p className="mt-1 text-xs font-medium text-amber-700">Awaiting reply</p>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <div className="space-y-5">
          <Card>
            <CardHeader title="Details" />
            <dl className="grid gap-4 p-5">
              <Info label="Diagnosis" value={claim.diagnosis} />
              <Info label="Stay" value={claim.admissionDate ? `${claim.admissionCode ? `${claim.admissionCode} · ` : ""}${formatDate(claim.admissionDate)} → ${formatDate(claim.dischargeDate)}` : undefined} />
              <Info label="Pre-auth" value={claim.preauthCode ? `${claim.preauthCode}${claim.authNo ? ` · auth ${claim.authNo}` : ""}` : claim.authNo} />
              <Info label="Submitted" value={claim.submittedDate ? formatDate(claim.submittedDate) : undefined} />
              <Info label="Remarks" value={claim.remarks} />
            </dl>
            {claim.preauth && <p className="px-5 pb-4 text-sm"><Link href={`/insurance/preauth/${claim.preauth}`} className="text-brand-700 hover:underline">Open pre-auth →</Link></p>}
          </Card>
          {claim.bill && (
            <Card>
              <CardHeader title={`Bill ${claim.bill.code}`} description={claim.billDate ? `Dated ${formatDate(claim.billDate)}` : undefined} actions={<Link href={`/billing/bills/${claim.bill.id}`} className="text-xs font-medium text-brand-700 hover:underline">Open bill →</Link>} />
              <dl className="grid grid-cols-2 gap-3 p-5 text-sm">
                <Info label="Status" value={claim.bill.status} />
                <Info label="Net bill" value={formatMoney(claim.bill.netAmount)} />
                <Info label="Insurer share" value={formatMoney(claim.bill.payerShare)} />
                <Info label="Insurer due" value={formatMoney(claim.bill.payerDue)} />
                <Info label="Written off" value={formatMoney(claim.bill.payerWriteOff)} />
                <Info label="Patient due" value={formatMoney(claim.bill.patientDue)} />
              </dl>
            </Card>
          )}
          <Timeline events={claim.events} />
        </div>
      </div>

      {dialog && (
        <FormModal title={dialog.title} description={dialog.description} fields={dialog.fields} confirmLabel={dialog.confirm} danger={dialog.danger} size={dialog.size} onClose={() => setDialog(null)} onSubmit={(v) => run(dialog.body(v), dialog.msg)}>
          {dialog.preview}
        </FormModal>
      )}
    </>
  );
}
