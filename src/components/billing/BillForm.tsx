"use client";

import { ArrowLeft, FileCheck2, Save } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { r2 } from "@/lib/billing-math";
import { ApiClientError, api, qs } from "@/lib/client";
import { formatDate, formatMoney } from "@/lib/format";
import { BILL_TYPES, PAYER_TYPES, RATE_PLANS } from "@/lib/modules";
import { useApiQuery } from "@/lib/useApi";
import { RefSelect, type RefOption } from "../RecordForm";
import { Alert, Badge, Button, Card, CardHeader, Field, Kbd, Spinner, cx, errorRing, inputClass, omitKey, useHotkeys, useToast } from "../ui";
import { ChargePicker, linesPayload, previewTotals, type DraftLine } from "./ChargePicker";
import { ShiftNotice, SplitsEditor, emptySplit, splitsPayload, splitsTotal, type SplitDraft } from "./Receipts";
import type { Bill, DeptDue } from "./types";

interface PatientContext {
  patient: { id: string; name: string; code: string; gender: string; age: number | null; mobile: string };
  visits: { id: string; code: string; date: string; department: string; status: string; doctor: RefOption | null }[];
  admissions: { id: string; code: string; date: string; ward: string; bed: string; doctor: RefOption | null; days: number }[];
  openBills: { id: string; code: string; billType: string; date: string; admissionCode: string | null; netAmount: number; paid: number }[];
  previousDue: number;
  deptDues: DeptDue[];
}

const patientRef = { name: "patient", label: "Patient", type: "ref" as const, ref: "patients.patients", required: true };
const doctorRef = { name: "doctor", label: "Consultant", type: "ref" as const, ref: "doctors.doctors" };
const corporateRef = { name: "corporate", label: "Corporate / credit party", type: "ref" as const, ref: "billing.corporates", required: true };
const insurerRef = { name: "insuranceProvider", label: "Insurance company", type: "ref" as const, ref: "insurance.providers", refFilter: { payerType: "Insurance Company|Government Scheme" }, required: true };

/** Open a hospital bill (OPD, IPD, emergency, day care), optionally finalising and collecting at once. */
export function BillForm({ initialPatient }: { initialPatient?: RefOption }) {
  const router = useRouter();
  const toast = useToast();
  const [patient, setPatient] = useState(initialPatient?.id ?? "");
  const ctx = useApiQuery<PatientContext>(patient ? `/api/billing/patient-context${qs({ patient })}` : null);
  const c = ctx.data;
  const [billType, setBillType] = useState("OPD");
  const [visit, setVisit] = useState("");
  const [admission, setAdmission] = useState("");
  const [doctor, setDoctor] = useState("");
  const [department, setDepartment] = useState("");
  const [payerType, setPayerType] = useState("Self");
  const [payer, setPayer] = useState({ corporate: "", insuranceProvider: "", policyNo: "", tpaName: "", authNo: "", payerLimit: "" });
  const [ratePlan, setRatePlan] = useState("General");
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [discount, setDiscount] = useState("");
  const [discountReason, setDiscountReason] = useState("");
  const [discountApprovedBy, setDiscountApprovedBy] = useState("");
  const [notes, setNotes] = useState("");
  const [finalize, setFinalize] = useState(false);
  const [discharge, setDischarge] = useState(false);
  const [collect, setCollect] = useState(false);
  const [splits, setSplits] = useState<SplitDraft[]>([emptySplit()]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const clear = (k: string) => errors[k] && setErrors((e) => omitKey(e, k));
  const plan = payerType === "Corporate" ? "Corporate" : payerType === "Insurance" ? "Insurance" : ratePlan;
  const adm = c?.admissions.find((a) => a.id === admission);
  const preview = previewTotals(lines, Number(discount) || 0);
  const lineDiscounts = lines.some((l) => Number(l.discountPct) > 0);
  const needsReason = (Number(discount) || 0) > 0 || lineDiscounts;
  const collectKind = billType === "IPD" && !finalize ? "Advance" : "Payment";

  function pickPatient(id: string) {
    setPatient(id);
    setVisit("");
    setAdmission("");
  }

  async function save() {
    setFormError(null);
    const errs: Record<string, string> = {};
    if (!patient) errs.patient = "Select the patient";
    if (billType === "IPD" && !admission) errs.admission = "Select the patient's admission";
    if (payerType === "Corporate" && !payer.corporate) errs.corporate = "Select the corporate / credit party";
    if (payerType === "Insurance" && !payer.insuranceProvider) errs.insuranceProvider = "Select the insurance company";
    if (payerType === "Insurance" && !payer.policyNo.trim()) errs.policyNo = "Enter the policy / card number";
    if (needsReason && discountReason.trim().length < 3) errs.discountReason = "Enter the reason for the discount";
    if (finalize && lines.length === 0) errs.lines = "Add at least one charge before finalising";
    if (collect && !(splitsTotal(splits) > 0)) errs["splits.0"] = "Enter the amount received";
    setErrors(errs);
    if (Object.keys(errs).length) return setFormError("Please correct the highlighted fields.");
    setSaving(true);
    try {
      const { data } = await api<Bill>("/api/billing/bills", {
        method: "POST",
        body: {
          patient, billType, visit: billType !== "IPD" ? visit || undefined : undefined, admission: billType === "IPD" ? admission : undefined,
          doctor: doctor || undefined, department: department.trim() || undefined,
          // Self-pay IPD bills are sent without a payer so an approved cashless pre-auth is applied automatically.
          ...(payerType === "Self" ? { ratePlan } : { payerType, ...payer }),
          lines: linesPayload(lines), discount: Number(discount) || 0, discountReason: discountReason.trim() || undefined, discountApprovedBy: discountApprovedBy.trim() || undefined,
          notes: notes.trim() || undefined, finalize, discharge: finalize && discharge,
          payment: collect ? { kind: collectKind, splits: splitsPayload(splits) } : undefined,
        },
      });
      toast(`Bill ${data.code} ${finalize ? "finalised" : "opened"}`);
      router.push(`/billing/bills/${data.id}`);
    } catch (e) {
      if (e instanceof ApiClientError && e.fields) setErrors(e.fields);
      setFormError((e as Error).message);
      setSaving(false);
    }
  }
  useHotkeys({ "ctrl+s": save, F10: save });

  const lineError = Object.entries(errors).find(([k]) => k === "lines" || k.startsWith("lines."))?.[1];

  return (
    <>
      <Link href="/m/billing?tab=bills" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="size-4" /> Back to bills</Link>
      <h1 className="mb-5 text-xl font-semibold text-slate-900">New hospital bill</h1>
      {formError && <div className="mb-4"><Alert>{formError}</Alert></div>}
      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Card>
            <CardHeader title="Patient & episode" />
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <Field label="Patient" htmlFor="bill-patient" required error={errors.patient} className="sm:col-span-2">
                <RefSelect id="bill-patient" field={patientRef} value={patient} initial={initialPatient} className={cx(inputClass, errorRing(errors.patient))} onChange={(v) => { pickPatient(v); clear("patient"); }} />
              </Field>
              {patient && ctx.loading && <div className="sm:col-span-2"><Spinner label="Loading patient…" /></div>}
              {ctx.error && <div className="sm:col-span-2"><Alert>{ctx.error}</Alert></div>}
              {c && (
                <>
                  {c.openBills.length > 0 && (
                    <div className="sm:col-span-2">
                      <Alert tone="amber">
                        Open bill{c.openBills.length > 1 ? "s" : ""}:{" "}
                        {c.openBills.map((b, i) => (
                          <span key={b.id}>{i > 0 && ", "}<Link href={`/billing/bills/${b.id}`} className="font-mono font-medium underline">{b.code}</Link> ({b.billType}{b.admissionCode ? ` · ${b.admissionCode}` : ""}, {formatMoney(b.netAmount)})</span>
                        ))}
                        . Add charges there instead of opening another bill for the same episode.
                      </Alert>
                    </div>
                  )}
                  <Field label="Bill type" htmlFor="bill-type" required error={errors.billType}>
                    <select id="bill-type" value={billType} onChange={(e) => { setBillType(e.target.value); setDischarge(false); }} className={inputClass}>
                      {BILL_TYPES.map((t) => <option key={t}>{t}</option>)}
                    </select>
                  </Field>
                  {billType === "IPD" ? (
                    <Field label="Admission" htmlFor="bill-admission" required error={errors.admission} hint={c.admissions.length ? undefined : "The patient has no current admission. Admit them under OPD / IPD first."}>
                      <select id="bill-admission" value={admission} onChange={(e) => { setAdmission(e.target.value); clear("admission"); }} className={cx(inputClass, errorRing(errors.admission))}>
                        <option value="">Select…</option>
                        {c.admissions.map((a) => <option key={a.id} value={a.id}>{a.code} · {formatDate(a.date)} · {a.ward}/{a.bed} · {a.days} day(s)</option>)}
                      </select>
                    </Field>
                  ) : (
                    <Field label="OPD visit" htmlFor="bill-visit" error={errors.visit} hint="Visits of the last 30 days">
                      <select id="bill-visit" value={visit} onChange={(e) => setVisit(e.target.value)} className={inputClass}>
                        <option value="">None</option>
                        {c.visits.map((v) => <option key={v.id} value={v.id}>{v.code} · {formatDate(v.date)}{v.department ? ` · ${v.department}` : ""}{v.doctor ? ` · ${v.doctor.label}` : ""}</option>)}
                      </select>
                    </Field>
                  )}
                  <Field label="Consultant" htmlFor="bill-doctor" error={errors.doctor} hint="Defaults to the visit / admission doctor">
                    <RefSelect id="bill-doctor" field={doctorRef} value={doctor} className={inputClass} onChange={setDoctor} />
                  </Field>
                  <Field label="Department" htmlFor="bill-department">
                    <input id="bill-department" maxLength={60} value={department} onChange={(e) => setDepartment(e.target.value)} className={inputClass} />
                  </Field>
                  {(c.previousDue > 0 || c.deptDues.length > 0) && (
                    <div className="sm:col-span-2">
                      <Alert tone="amber">
                        {c.previousDue > 0 && <p>Previous hospital bills due: <strong>{formatMoney(c.previousDue)}</strong></p>}
                        {c.deptDues.map((d) => <p key={d.id}>{d.source} {d.code} ({formatDate(d.date)}): {formatMoney(d.balance)} due</p>)}
                      </Alert>
                    </div>
                  )}
                </>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Charges" description={`Priced at the ${plan} rate plan. The server re-prices every charge from the masters.`} />
            <div className="p-5">
              <ChargePicker lines={lines} onChange={(l) => { setLines(l); clear("lines"); }} plan={plan} billType={billType} stayDays={adm?.days} error={lineError} />
            </div>
          </Card>

          <Card>
            <CardHeader title="Discount & notes" />
            <div className="grid gap-4 p-5 sm:grid-cols-3">
              <Field label="Bill discount (₹)" htmlFor="bill-discount" error={errors.discount}>
                <input id="bill-discount" type="number" min={0} step="any" value={discount} onChange={(e) => { setDiscount(e.target.value); clear("discount"); }} className={cx(inputClass, errorRing(errors.discount))} />
              </Field>
              <Field label="Discount reason" htmlFor="bill-discountReason" required={needsReason} error={errors.discountReason} className="sm:col-span-2">
                <input id="bill-discountReason" maxLength={300} value={discountReason} onChange={(e) => { setDiscountReason(e.target.value); clear("discountReason"); }} className={cx(inputClass, errorRing(errors.discountReason))} />
              </Field>
              <Field label="Discount approved by" htmlFor="bill-discountApprovedBy">
                <input id="bill-discountApprovedBy" maxLength={80} value={discountApprovedBy} onChange={(e) => setDiscountApprovedBy(e.target.value)} className={inputClass} />
              </Field>
              <Field label="Notes" htmlFor="bill-notes" className="sm:col-span-2">
                <input id="bill-notes" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} />
              </Field>
            </div>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Payer" />
            <div className="grid gap-4 p-5">
              <Field label="Bill to" htmlFor="bill-payerType" required hint={billType === "IPD" && payerType === "Self" ? "An approved cashless pre-auth on the admission switches the bill to the insurer" : undefined}>
                <select id="bill-payerType" value={payerType} onChange={(e) => setPayerType(e.target.value)} className={inputClass}>
                  {PAYER_TYPES.map((t) => <option key={t} value={t}>{t === "Self" ? "Self (patient pays)" : t}</option>)}
                </select>
              </Field>
              {payerType === "Self" && (
                <Field label="Rate plan" htmlFor="bill-ratePlan" required>
                  <select id="bill-ratePlan" value={ratePlan} onChange={(e) => setRatePlan(e.target.value)} className={inputClass}>
                    {RATE_PLANS.filter((p) => p !== "Corporate" && p !== "Insurance").map((p) => <option key={p}>{p}</option>)}
                  </select>
                </Field>
              )}
              {payerType === "Corporate" && (
                <Field label="Corporate / credit party" htmlFor="bill-corporate" required error={errors.corporate}>
                  <RefSelect id="bill-corporate" field={corporateRef} value={payer.corporate} className={cx(inputClass, errorRing(errors.corporate))} onChange={(v) => { setPayer((p) => ({ ...p, corporate: v })); clear("corporate"); }} />
                </Field>
              )}
              {payerType === "Insurance" && (
                <Field label="Insurance company" htmlFor="bill-insurer" required error={errors.insuranceProvider}>
                  <RefSelect id="bill-insurer" field={insurerRef} value={payer.insuranceProvider} className={cx(inputClass, errorRing(errors.insuranceProvider))} onChange={(v) => { setPayer((p) => ({ ...p, insuranceProvider: v })); clear("insuranceProvider"); }} />
                </Field>
              )}
              {payerType !== "Self" && (
                <>
                  <Field label={payerType === "Insurance" ? "Policy / card no." : "Employee / card no."} htmlFor="bill-policyNo" required={payerType === "Insurance"} error={errors.policyNo}>
                    <input id="bill-policyNo" maxLength={60} value={payer.policyNo} onChange={(e) => { setPayer((p) => ({ ...p, policyNo: e.target.value })); clear("policyNo"); }} className={cx(inputClass, errorRing(errors.policyNo))} />
                  </Field>
                  {payerType === "Insurance" && (
                    <Field label="TPA" htmlFor="bill-tpaName">
                      <input id="bill-tpaName" maxLength={80} value={payer.tpaName} onChange={(e) => setPayer((p) => ({ ...p, tpaName: e.target.value }))} className={inputClass} />
                    </Field>
                  )}
                  <Field label="Authorisation no." htmlFor="bill-authNo">
                    <input id="bill-authNo" maxLength={60} value={payer.authNo} onChange={(e) => setPayer((p) => ({ ...p, authNo: e.target.value }))} className={inputClass} />
                  </Field>
                  <Field label="Approved amount (₹)" htmlFor="bill-payerLimit" error={errors.payerLimit} hint="The payer never covers more than this; the rest is the patient's">
                    <input id="bill-payerLimit" type="number" min={0} step="any" value={payer.payerLimit} onChange={(e) => setPayer((p) => ({ ...p, payerLimit: e.target.value }))} className={cx(inputClass, errorRing(errors.payerLimit))} />
                  </Field>
                </>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Bill total" />
            <div className="space-y-4 p-5">
              <dl className="space-y-1 text-sm tabular-nums">
                <div className="flex justify-between"><dt className="text-slate-600">Gross</dt><dd>{formatMoney(preview.totals.grossAmount)}</dd></div>
                {preview.totals.discountAmount > 0 && <div className="flex justify-between"><dt className="text-slate-600">Discount</dt><dd>−{formatMoney(preview.totals.discountAmount)}</dd></div>}
                {preview.totals.gstAmount > 0 && <div className="flex justify-between"><dt className="text-slate-600">GST</dt><dd>{formatMoney(preview.totals.gstAmount)}</dd></div>}
                {preview.totals.roundOff !== 0 && <div className="flex justify-between"><dt className="text-slate-600">Round off</dt><dd>{formatMoney(preview.totals.roundOff)}</dd></div>}
                <div className="flex justify-between border-t border-slate-200 pt-1 text-base font-semibold"><dt>Net amount</dt><dd>{formatMoney(preview.totals.netAmount)}</dd></div>
                {payerType !== "Self" && <p className="text-xs text-slate-500">The payer and patient shares are worked out when the bill is saved.</p>}
              </dl>
              <label className="flex items-start gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={finalize} onChange={(e) => setFinalize(e.target.checked)} className="mt-0.5 size-4 rounded border-slate-300 text-brand-600" />
                <span>Finalise now<span className="block text-xs text-slate-500">Leave unticked to keep a provisional (running) bill that charges can be added to.</span></span>
              </label>
              {finalize && billType === "IPD" && (
                <label className="flex items-start gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={discharge} onChange={(e) => setDischarge(e.target.checked)} className="mt-0.5 size-4 rounded border-slate-300 text-brand-600" />
                  <span>Discharge the patient from {adm?.code ?? "the admission"}</span>
                </label>
              )}
              <label className="flex items-start gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={collect} onChange={(e) => setCollect(e.target.checked)} className="mt-0.5 size-4 rounded border-slate-300 text-brand-600" />
                <span>Collect {collectKind === "Advance" ? "an advance" : "payment"} now</span>
              </label>
              {collect && (
                <div className="space-y-2">
                  <ShiftNotice />
                  <SplitsEditor splits={splits} onChange={(s) => { setSplits(s); clear("splits.0"); }} errors={errors} disabled={saving} />
                  {payerType === "Self" && collectKind === "Payment" && splitsTotal(splits) > preview.totals.netAmount && (
                    <p className="text-xs text-amber-700">More than the bill total ({formatMoney(preview.totals.netAmount)}). Take the excess as an advance on a provisional bill instead.</p>
                  )}
                  {splitsTotal(splits) > 0 && <p className="text-xs text-slate-500">Receiving {formatMoney(splitsTotal(splits))}{collectKind === "Payment" && payerType === "Self" ? ` · balance ${formatMoney(r2(Math.max(0, preview.totals.netAmount - splitsTotal(splits))))}` : ""}</p>}
                </div>
              )}
              <Button className="w-full" onClick={save} loading={saving}>
                {finalize ? <><FileCheck2 className="size-4" /> Save final bill</> : <><Save className="size-4" /> Open provisional bill</>} <Kbd>F10</Kbd>
              </Button>
              {c && <p className="text-xs text-slate-500">{c.patient.name} {c.patient.code && <Badge>{c.patient.code}</Badge>} {[c.patient.age != null ? `${c.patient.age} y` : null, c.patient.gender, c.patient.mobile].filter(Boolean).join(" · ")}</p>}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
