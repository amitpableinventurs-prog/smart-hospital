"use client";

import { ArrowLeft, FilePlus2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiClientError, api } from "@/lib/client";
import { formatDate, formatMoney } from "@/lib/format";
import { RefSelect, type RefOption } from "../RecordForm";
import { Alert, Button, Card, CardHeader, Field, cx, errorRing, inputClass, omitKey, useToast } from "../ui";
import { PolicyPicker, patientRef, usePatientCover } from "./PreauthForm";

/** Raise a claim from a final insurance bill, or record a reimbursement claim. */
export function ClaimForm({ initialPatient }: { initialPatient?: RefOption }) {
  const router = useRouter();
  const toast = useToast();
  const [patient, setPatient] = useState(initialPatient?.id ?? "");
  const { cover, error: coverError } = usePatientCover(patient);
  const [mode, setMode] = useState<"bill" | "manual">("bill");
  const [bill, setBill] = useState("");
  const [policy, setPolicy] = useState("");
  const [form, setForm] = useState({ claimType: "Reimbursement", claimAmount: "", diagnosis: "", admissionDate: "", dischargeDate: "", remarks: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const bills = cover?.bills.filter((b) => !b.claimCode) ?? [];
  const set = (k: keyof typeof form, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    if (errors[k]) setErrors((e) => omitKey(e, k));
  };

  async function save() {
    setFormError(null);
    setSaving(true);
    try {
      const body = mode === "bill" ? { bill } : { patient, policy, ...form };
      const { data } = await api<{ id: string; code: string }>("/api/insurance/claims", { method: "POST", body });
      toast(`Claim ${data.code} raised`);
      router.push(`/insurance/claims/${data.id}`);
    } catch (e) {
      if (e instanceof ApiClientError && e.fields) setErrors(e.fields);
      setFormError((e as Error).message);
      setSaving(false);
    }
  }

  const input = (k: keyof typeof form, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <input id={`cl-${k}`} value={form[k]} onChange={(e) => set(k, e.target.value)} className={cx(inputClass, errorRing(errors[k]))} {...props} />
  );

  return (
    <>
      <Link href="/m/insurance?tab=claims" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="size-4" /> Back to claims</Link>
      <h1 className="mb-1 text-xl font-semibold text-slate-900">New insurance claim</h1>
      <p className="mb-5 text-sm text-slate-500">Cashless claims are normally raised automatically when Billing finalises an insurance bill. Use this for a bill finalised earlier, or to help a patient with a reimbursement claim.</p>
      {formError && <div className="mb-4"><Alert>{formError}</Alert></div>}
      <Card className="max-w-3xl">
        <CardHeader title="Claim" />
        <div className="space-y-4 p-5">
          <Field label="Patient" htmlFor="cl-patient" required error={errors.patient}>
            <RefSelect id="cl-patient" field={patientRef} value={patient} initial={initialPatient} className={cx(inputClass, errorRing(errors.patient))} onChange={(v) => { setPatient(v); setBill(""); setPolicy(""); }} />
          </Field>
          {coverError && <Alert>{coverError}</Alert>}
          {cover && (
            <>
              <div className="flex gap-1 rounded-lg bg-slate-100 p-1 text-sm" role="tablist">
                {([["bill", "From a final insurance bill"], ["manual", "Reimbursement / other"]] as const).map(([k, label]) => (
                  <button key={k} role="tab" aria-selected={mode === k} onClick={() => setMode(k)} className={cx("flex-1 rounded-md px-3 py-1.5 font-medium", mode === k ? "bg-white text-brand-700 shadow-sm" : "text-slate-600")}>{label}</button>
                ))}
              </div>
              {mode === "bill" ? (
                bills.length === 0 ? (
                  <Alert tone="amber">{cover.patient.name} has no final insurance bill without a claim. Finalise the IPD bill in Billing (the claim is then raised automatically), or record a reimbursement claim.</Alert>
                ) : (
                  <Field label="Final insurance bill" htmlFor="cl-bill" required error={errors.bill}>
                    <select id="cl-bill" value={bill} onChange={(e) => setBill(e.target.value)} className={cx(inputClass, errorRing(errors.bill))}>
                      <option value="">Select…</option>
                      {bills.map((b) => <option key={b.id} value={b.id}>{b.code} · {formatDate(b.date)} · {b.payerName} · insurer share {formatMoney(b.payerShare)}{b.admissionCode ? ` · ${b.admissionCode}` : ""}</option>)}
                    </select>
                  </Field>
                )
              ) : (
                <>
                  <PolicyPicker cover={cover} value={policy} onChange={setPolicy} error={errors.policy} />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Claim type" htmlFor="cl-claimType" required error={errors.claimType}>
                      <select id="cl-claimType" value={form.claimType} onChange={(e) => set("claimType", e.target.value)} className={inputClass}>
                        <option>Reimbursement</option>
                        <option>Cashless</option>
                      </select>
                    </Field>
                    <Field label="Amount claimed" htmlFor="cl-claimAmount" required error={errors.claimAmount}>{input("claimAmount", { type: "number", min: 0, inputMode: "decimal" })}</Field>
                    <Field label="Diagnosis" htmlFor="cl-diagnosis" required error={errors.diagnosis} className="sm:col-span-2">{input("diagnosis", { maxLength: 300 })}</Field>
                    <Field label="Admitted on" htmlFor="cl-admissionDate" error={errors.admissionDate}>{input("admissionDate", { type: "date" })}</Field>
                    <Field label="Discharged on" htmlFor="cl-dischargeDate" error={errors.dischargeDate}>{input("dischargeDate", { type: "date" })}</Field>
                    <Field label="Remarks" htmlFor="cl-remarks" className="sm:col-span-2">
                      <textarea id="cl-remarks" rows={2} maxLength={1000} value={form.remarks} onChange={(e) => set("remarks", e.target.value)} className={inputClass} />
                    </Field>
                  </div>
                </>
              )}
              <div className="flex justify-end">
                <Button onClick={save} loading={saving} disabled={mode === "bill" ? !bill : !policy}><FilePlus2 className="size-4" /> Raise claim</Button>
              </div>
            </>
          )}
        </div>
      </Card>
    </>
  );
}
