"use client";

import { ArrowLeft, Ban, CheckCircle2, FileQuestion, Link2, MessageSquareReply, Receipt, Send, TrendingUp, XCircle } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { api } from "@/lib/client";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { useApiQuery } from "@/lib/useApi";
import { FormModal, numOrUndefined, type ModalField, type ModalValues } from "../FormModal";
import { Figure, Info, Timeline, type TimelineEvent } from "../DetailBits";
import { Alert, Badge, Button, Card, CardHeader, EmptyState, ErrorState, Spinner, useToast } from "../ui";
import { insuranceTone } from "./InsuranceSection";
import { usePatientCover } from "./PreauthForm";

interface Query { _id: string; raisedAt: string; query: string; raisedByName?: string; response?: string; respondedAt?: string; respondedByName?: string }
interface Enhancement { _id: string; requestedAmount: number; reason?: string; requestedAt: string; requestedByName?: string; status: string; approvedAmount?: number; decidedAt?: string; remarks?: string }

interface Preauth {
  id: string;
  code: string;
  status: string;
  patient: string;
  patientName: string;
  patientCode?: string;
  patientAge?: number;
  patientGender?: string;
  patientMobile?: string;
  insurerName?: string;
  tpaName?: string;
  policyNumber?: string;
  memberId?: string;
  sumInsured?: number;
  copayPct?: number;
  admission?: string;
  admissionCode?: string;
  admissionDate?: string;
  plannedAdmissionDate?: string;
  doctorName?: string;
  department?: string;
  diagnosis: string;
  icdCode?: string;
  treatmentType?: string;
  procedure?: string;
  expectedStayDays?: number;
  roomCategory?: string;
  estimatedAmount: number;
  requestedAmount: number;
  approvedAmount: number;
  authNo?: string;
  submittedAt?: string;
  approvedAt?: string;
  rejectReason?: string;
  cancelReason?: string;
  queries: Query[];
  enhancements: Enhancement[];
  billCode?: string;
  billSyncedAt?: string;
  claim?: string;
  claimCode?: string;
  events: TimelineEvent[];
  notes?: string;
  createdByName?: string;
  createdAt: string;
  cover: { sumInsured: number; used: number; available: number; validTo: string | null; roomRentLimit: number | null; copayPct: number | null } | null;
  currentBill: { id: string; code: string; status: string; payerType: string; payerName: string | null; payerLimit: number | null; authNo: string | null; netAmount: number; payerShare: number } | null;
}

type Dialog = { title: string; description?: string; fields: ModalField[]; confirm: string; danger?: boolean; body: (v: ModalValues) => Record<string, unknown>; msg: string };

export function PreauthView({ id }: { id: string }) {
  const toast = useToast();
  const q = useApiQuery<Preauth>(`/api/insurance/preauths/${id}`);
  const [latest, setLatest] = useState<Preauth | null>(null);
  const pre = latest?.id === id ? latest : q.data;
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const needAdmissions = !!pre && !pre.admission && ["Draft", "Submitted", "Query Raised", "Approved", "Enhancement Requested"].includes(pre.status);
  const { cover } = usePatientCover(needAdmissions ? pre!.patient : "");

  const back = (
    <Link href="/m/insurance?tab=preauth" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="size-4" /> Back to pre-authorisations</Link>
  );
  if (q.error) return <>{back}<Card>{q.status === 404 ? <EmptyState title="Pre-authorisation not found" /> : <ErrorState message={q.error} onRetry={q.reload} />}</Card></>;
  if (!pre) return <>{back}<Spinner label="Loading pre-authorisation…" /></>;

  const run = async (body: Record<string, unknown>, msg: string) => {
    const { data } = await api<Preauth>(`/api/insurance/preauths/${id}/action`, { method: "POST", body });
    setLatest(data);
    setDialog(null);
    toast(msg);
  };
  const quick = async (action: string, msg: string) => {
    setBusy(action);
    try {
      await run({ action }, msg);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  };
  const pendingEnhancement = pre.enhancements.find((e) => e.status === "Pending");
  const s = pre.status;
  const payer = pre.tpaName ?? pre.insurerName;

  const actions: ReactNode[] = [];
  if (s === "Draft") actions.push(<Button key="submit" loading={busy === "submit"} onClick={() => quick("submit", "Submitted to insurer")}><Send className="size-4" /> Submit to {payer}</Button>);
  if (s === "Submitted" || s === "Query Raised") {
    actions.push(
      <Button key="approve" onClick={() => setDialog({
        title: "Record approval", description: `Requested ${formatMoney(pre.requestedAmount)}`, confirm: "Record approval", msg: "Approval recorded",
        fields: [
          { name: "authNo", label: "Authorisation / approval no.", required: true, maxLength: 60 },
          { name: "approvedAmount", label: "Amount approved", type: "number", required: true, min: 0, defaultValue: String(pre.requestedAmount) },
          { name: "remarks", label: "Insurer's remarks", maxLength: 200 },
        ],
        body: (v) => ({ action: "approve", authNo: v.authNo, approvedAmount: numOrUndefined(v.approvedAmount), remarks: v.remarks }),
      })}><CheckCircle2 className="size-4" /> Approved</Button>,
      <Button key="reject" variant="secondary" className="text-red-600" onClick={() => setDialog({
        title: "Record rejection", confirm: "Record rejection", danger: true, msg: "Rejection recorded", fields: [{ name: "reason", label: "Insurer's reason", type: "textarea", required: true, maxLength: 500 }],
        body: (v) => ({ action: "reject", reason: v.reason }),
      })}><XCircle className="size-4" /> Rejected</Button>
    );
  }
  if (s === "Submitted" || s === "Enhancement Requested") {
    actions.push(<Button key="query" variant="secondary" onClick={() => setDialog({
      title: "Record insurer query", confirm: "Record query", msg: "Query recorded",
      fields: [{ name: "query", label: "Query / documents asked for", type: "textarea", required: true, maxLength: 1000 }, { name: "raisedOn", label: "Raised on", type: "date", defaultValue: new Date().toISOString().slice(0, 10) }],
      body: (v) => ({ action: "query", query: v.query, raisedOn: v.raisedOn }),
    })}><FileQuestion className="size-4" /> Query raised</Button>);
  }
  if (s === "Query Raised") {
    actions.push(<Button key="respond" onClick={() => setDialog({
      title: "Reply to query", description: [...pre.queries].reverse().find((x) => !x.response)?.query, confirm: "Save reply", msg: "Reply recorded",
      fields: [{ name: "response", label: "Reply / documents sent", type: "textarea", required: true, maxLength: 1000 }], body: (v) => ({ action: "respond", response: v.response }),
    })}><MessageSquareReply className="size-4" /> Reply sent</Button>);
  }
  if (s === "Approved") {
    actions.push(<Button key="enhance" variant="secondary" onClick={() => setDialog({
      title: "Request enhancement", description: `Approved so far ${formatMoney(pre.approvedAmount)}`, confirm: "Request", msg: "Enhancement requested",
      fields: [{ name: "amount", label: "Additional amount", type: "number", required: true, min: 0 }, { name: "reason", label: "Reason (extended stay, change of plan…)", type: "textarea", required: true, maxLength: 500 }],
      body: (v) => ({ action: "enhance", amount: numOrUndefined(v.amount), reason: v.reason }),
    })}><TrendingUp className="size-4" /> Request enhancement</Button>);
  }
  if (s === "Enhancement Requested" && pendingEnhancement) {
    actions.push(<Button key="decide" onClick={() => setDialog({
      title: "Record enhancement decision", description: `Requested ${formatMoney(pendingEnhancement.requestedAmount)}: ${pendingEnhancement.reason ?? ""}`, confirm: "Save decision", msg: "Enhancement decision recorded",
      fields: [
        { name: "decision", label: "Decision", type: "select", options: ["Approved", "Rejected"], required: true },
        { name: "approvedAmount", label: "Amount approved", type: "number", min: 0, defaultValue: String(pendingEnhancement.requestedAmount), hint: "For an approval" },
        { name: "authNo", label: "Revised authorisation no.", maxLength: 60, hint: "If the insurer issued a new one" },
        { name: "remarks", label: "Insurer's remarks", maxLength: 200, hint: "Required for a rejection" },
      ],
      body: (v) => ({ action: "decide-enhancement", decision: v.decision, approvedAmount: numOrUndefined(v.approvedAmount), authNo: v.authNo, remarks: v.remarks }),
    })}><CheckCircle2 className="size-4" /> Enhancement decision</Button>);
  }
  if ((s === "Approved" || s === "Enhancement Requested") && pre.admission) {
    actions.push(<Button key="sync" variant="secondary" loading={busy === "sync-bill"} onClick={() => quick("sync-bill", "Applied to the IPD bill")}><Receipt className="size-4" /> Apply to IPD bill</Button>);
  }
  if (needAdmissions && cover?.admissions.length) {
    actions.push(<Button key="link" variant="secondary" onClick={() => setDialog({
      title: "Link admission", description: "The approval is applied to this admission's IPD bill.", confirm: "Link", msg: "Admission linked",
      fields: [{ name: "admission", label: "Admission", type: "select", required: true, options: cover.admissions.map((a) => `${a.code} · ${formatDate(a.date)}`) }],
      body: (v) => ({ action: "link-admission", admission: cover.admissions.find((a) => `${a.code} · ${formatDate(a.date)}` === v.admission)?.id }),
    })}><Link2 className="size-4" /> Link admission</Button>);
  }
  if (["Draft", "Submitted", "Query Raised", "Approved", "Enhancement Requested"].includes(s)) {
    actions.push(<Button key="cancel" variant="secondary" className="text-red-600" onClick={() => setDialog({
      title: "Cancel pre-authorisation?", description: "Use when the patient is not admitted, changes insurer or opts for self-pay.", confirm: "Cancel pre-auth", danger: true, msg: "Pre-auth cancelled",
      fields: [{ name: "reason", label: "Reason", required: true, maxLength: 300 }], body: (v) => ({ action: "cancel", reason: v.reason }),
    })}><Ban className="size-4" /> Cancel</Button>);
  }

  return (
    <>
      {back}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-slate-900">Pre-auth <span className="font-mono">{pre.code}</span></h1>
            <Badge tone={insuranceTone(s)}>{s}</Badge>
            {pre.authNo && <Badge tone="green">Auth {pre.authNo}</Badge>}
          </div>
          <p className="mt-1 text-sm text-slate-500">{pre.patientName} ({pre.patientCode}) · {pre.insurerName}{pre.tpaName ? ` via ${pre.tpaName}` : ""} · created {formatDateTime(pre.createdAt)} by {pre.createdByName ?? "—"}</p>
        </div>
        <div className="flex flex-wrap gap-2">{actions}</div>
      </div>

      {s === "Rejected" && <div className="mb-4"><Alert>Rejected: {pre.rejectReason}. Collect from the patient, or request reconsideration and record a fresh pre-auth.</Alert></div>}
      {s === "Cancelled" && <div className="mb-4"><Alert tone="amber">Cancelled: {pre.cancelReason}</Alert></div>}
      {s === "Query Raised" && <div className="mb-4"><Alert tone="amber">The insurer has a query. Send the reply / documents and record it with &ldquo;Reply sent&rdquo;.</Alert></div>}
      {needAdmissions && cover && !cover.admissions.length && <div className="mb-4"><Alert tone="amber">Not admitted yet (planned {formatDate(pre.plannedAdmissionDate)}). Admit the patient in OPD / IPD, then link the admission here.</Alert></div>}

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <div className="grid gap-4 sm:grid-cols-3">
            <Figure label="Requested" value={formatMoney(pre.requestedAmount)} hint={`Estimate ${formatMoney(pre.estimatedAmount)}`} />
            <Figure label="Approved" value={pre.approvedAmount ? formatMoney(pre.approvedAmount) : "—"} hint={pre.approvedAt ? `on ${formatDateTime(pre.approvedAt)}` : undefined} tone={pre.approvedAmount ? "green" : undefined} />
            <Figure label="Cover still available" value={pre.cover ? formatMoney(pre.cover.available) : "—"} hint={pre.cover ? `of ${formatMoney(pre.cover.sumInsured)} sum insured` : undefined} />
          </div>
          <Card>
            <CardHeader title="Clinical details" />
            <dl className="grid gap-4 p-5 sm:grid-cols-2">
              <Info label="Diagnosis" value={`${pre.diagnosis}${pre.icdCode ? ` (ICD ${pre.icdCode})` : ""}`} wide />
              <Info label="Line of treatment" value={pre.treatmentType} />
              <Info label="Procedure" value={pre.procedure} />
              <Info label="Admission" value={pre.admissionCode ? `${pre.admissionCode} · ${formatDate(pre.admissionDate)}` : `Planned ${formatDate(pre.plannedAdmissionDate)}`} />
              <Info label="Treating doctor" value={pre.doctorName ? `${pre.doctorName}${pre.department ? ` · ${pre.department}` : ""}` : undefined} />
              <Info label="Expected stay" value={pre.expectedStayDays != null ? `${pre.expectedStayDays} days` : undefined} />
              <Info label="Room category" value={pre.roomCategory} />
              <Info label="Policy" value={`${pre.policyNumber ?? "—"}${pre.memberId ? ` · member ${pre.memberId}` : ""}`} />
              <Info label="Co-pay / room limit" value={[pre.cover?.copayPct ? `${pre.cover.copayPct}% co-pay` : null, pre.cover?.roomRentLimit ? `${formatMoney(pre.cover.roomRentLimit)}/day room` : null].filter(Boolean).join(" · ") || undefined} />
              {pre.notes && <Info label="Notes" value={pre.notes} wide />}
            </dl>
          </Card>
          <Card>
            <CardHeader title="Queries" description="Questions from the insurer / TPA and the hospital's replies" />
            {pre.queries.length === 0 ? <p className="px-5 py-4 text-sm text-slate-500">No queries.</p> : (
              <ul className="divide-y divide-slate-100">
                {pre.queries.map((x) => (
                  <li key={x._id} className="px-5 py-3 text-sm">
                    <p className="text-slate-900"><span className="text-xs text-slate-500">{formatDate(x.raisedAt)} · </span>{x.query}</p>
                    {x.response ? <p className="mt-1 text-slate-600"><span className="text-xs text-slate-500">Replied {formatDateTime(x.respondedAt)} by {x.respondedByName}: </span>{x.response}</p> : <p className="mt-1 text-xs font-medium text-amber-700">Awaiting reply</p>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {pre.enhancements.length > 0 && (
            <Card>
              <CardHeader title="Enhancements" />
              <ul className="divide-y divide-slate-100">
                {pre.enhancements.map((e, i) => (
                  <li key={e._id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                    <div><span className="font-medium">#{i + 1} · {formatMoney(e.requestedAmount)}</span> <span className="text-slate-500">— {e.reason}</span><span className="block text-xs text-slate-500">Requested {formatDateTime(e.requestedAt)}{e.decidedAt ? ` · decided ${formatDateTime(e.decidedAt)}` : ""}{e.remarks ? ` · ${e.remarks}` : ""}</span></div>
                    <Badge tone={insuranceTone(e.status)}>{e.status}{e.approvedAmount ? ` ${formatMoney(e.approvedAmount)}` : ""}</Badge>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
        <div className="space-y-5">
          <Card>
            <CardHeader title="Billing" description="The approval is applied to the admission's IPD bill" />
            <div className="space-y-2 p-5 text-sm">
              {pre.currentBill ? (
                <>
                  <p><span className="font-mono text-brand-700">{pre.currentBill.code}</span> · <Badge tone={insuranceTone(pre.currentBill.status)}>{pre.currentBill.status}</Badge></p>
                  <p className="text-slate-600">Payer: {pre.currentBill.payerType === "Self" ? "Self-pay" : `${pre.currentBill.payerName} (limit ${formatMoney(pre.currentBill.payerLimit)})`}</p>
                  <p className="text-slate-600">Net {formatMoney(pre.currentBill.netAmount)} · insurer share {formatMoney(pre.currentBill.payerShare)}</p>
                  {pre.currentBill.payerType === "Insurance" && pre.approvedAmount > 0 && pre.currentBill.payerLimit !== pre.approvedAmount && <p className="text-xs font-medium text-amber-700">The bill&apos;s limit differs from the approved {formatMoney(pre.approvedAmount)}. Use &ldquo;Apply to IPD bill&rdquo;.</p>}
                  {pre.billSyncedAt && <p className="text-xs text-slate-500">Last applied {formatDateTime(pre.billSyncedAt)}</p>}
                </>
              ) : <p className="text-slate-500">{pre.admission ? "No IPD bill opened yet. It opens as an insurance bill with this approval." : "Link the admission to apply the approval."}</p>}
              {pre.claimCode && <p className="pt-2">Claim <Link href={`/insurance/claims/${pre.claim}`} className="font-mono text-brand-700 hover:underline">{pre.claimCode}</Link> raised from the final bill.</p>}
            </div>
          </Card>
          <Timeline events={pre.events} />
        </div>
      </div>

      {dialog && (
        <FormModal title={dialog.title} description={dialog.description} fields={dialog.fields} confirmLabel={dialog.confirm} danger={dialog.danger} onClose={() => setDialog(null)} onSubmit={(v) => run(dialog.body(v), dialog.msg)} />
      )}
    </>
  );
}
