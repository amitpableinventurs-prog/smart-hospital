"use client";

import { ArrowLeft, ShieldPlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ApiClientError, api, qs } from "@/lib/client";
import { formatDate, formatMoney } from "@/lib/format";
import { RefSelect, type RefOption } from "../RecordForm";
import { Alert, Button, Card, CardHeader, Field, Kbd, cx, errorRing, inputClass, omitKey, useHotkeys, useToast } from "../ui";

export interface PatientCover {
  patient: { id: string; name: string; code: string; gender: string; age: number | null; mobile: string };
  policies: {
    id: string;
    policyNumber: string;
    memberId: string | null;
    policyType: string | null;
    insurer: string;
    tpa: string | null;
    sumInsured: number;
    copayPct: number | null;
    roomRentLimit: number | null;
    validFrom: string | null;
    validTo: string | null;
    status: string;
    usable: boolean;
    cover: { used: number; available: number };
  }[];
  admissions: { id: string; code: string; date: string | null; ward: string; bed: string; diagnosis: string | null; doctor: (RefOption & { department?: string }) | null }[];
  bills: { id: string; code: string; date: string; payerName: string | null; payerShare: number; claimCode: string | null; admissionCode: string | null; policyNo: string | null }[];
  openPreauths: { id: string; code: string; status: string; admissionCode: string | null; approvedAmount: number }[];
}

export const patientRef = { name: "patient", label: "Patient", type: "ref" as const, ref: "patients.patients", required: true };
const doctorRef = { name: "doctor", label: "Treating doctor", type: "ref" as const, ref: "doctors.doctors" };
const TREATMENTS = ["Medical Management", "Surgical", "Day Care", "Maternity", "ICU / Critical Care"];
const ROOMS = ["General Ward", "Semi-Private", "Private", "Deluxe", "ICU"];

/** Loads the patient's policies, admissions and insurance bills once a patient is picked. */
export function usePatientCover(patient: string) {
  const [cover, setCover] = useState<PatientCover | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!patient) return;
    let live = true;
    api<PatientCover>(`/api/insurance/patient-cover${qs({ patient })}`)
      .then(({ data }) => live && (setCover(data), setError(null)))
      .catch((e) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
  }, [patient]);
  return { cover: cover?.patient.id === patient ? cover : null, error };
}

/** Policy cards: pick one; expired / suspended ones are shown but cannot be chosen. */
export function PolicyPicker({ cover, value, onChange, error }: { cover: PatientCover; value: string; onChange: (id: string) => void; error?: string }) {
  if (!cover.policies.length) {
    return <Alert tone="amber">No insurance policy on record for {cover.patient.name}. <Link href="/m/insurance?tab=policies" className="font-medium underline">Add the policy</Link> under Patient Policies first.</Alert>;
  }
  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        {cover.policies.map((p) => (
          <button
            key={p.id}
            type="button"
            disabled={!p.usable}
            onClick={() => onChange(p.id)}
            className={cx(
              "rounded-lg border p-3 text-left text-sm transition",
              value === p.id ? "border-brand-500 bg-brand-50 ring-1 ring-brand-500" : "border-slate-200 hover:border-brand-300",
              !p.usable && "cursor-not-allowed opacity-50"
            )}
          >
            <p className="font-medium text-slate-900">{p.insurer}{p.tpa && <span className="font-normal text-slate-500"> via {p.tpa}</span>}</p>
            <p className="font-mono text-xs text-slate-600">{p.policyNumber}{p.memberId ? ` · ${p.memberId}` : ""}</p>
            <p className="mt-1 text-xs text-slate-500">
              Sum insured {formatMoney(p.sumInsured)} · available <span className={cx("font-medium", p.cover.available < p.sumInsured * 0.2 ? "text-amber-700" : "text-slate-700")}>{formatMoney(p.cover.available)}</span>
            </p>
            <p className="text-xs text-slate-500">
              {p.usable ? `Valid to ${formatDate(p.validTo)}` : <span className="font-medium text-red-600">{p.status === "Suspended" ? "Suspended" : `Expired ${formatDate(p.validTo)}`}</span>}
              {p.copayPct ? ` · co-pay ${p.copayPct}%` : ""}{p.roomRentLimit ? ` · room ${formatMoney(p.roomRentLimit)}/day` : ""}
            </p>
          </button>
        ))}
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

export function PreauthForm({ initialPatient }: { initialPatient?: RefOption }) {
  const router = useRouter();
  const toast = useToast();
  const [patient, setPatient] = useState(initialPatient?.id ?? "");
  const { cover, error: coverError } = usePatientCover(patient);
  const [policy, setPolicy] = useState("");
  const [admission, setAdmission] = useState("");
  const [planned, setPlanned] = useState("");
  const [doctor, setDoctor] = useState<RefOption | null>(null);
  const [doctorKey, setDoctorKey] = useState(0);
  const [form, setForm] = useState({ diagnosis: "", icdCode: "", treatmentType: "Medical Management", procedure: "", expectedStayDays: "", roomCategory: "", estimatedAmount: "", requestedAmount: "", notes: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState<"draft" | "submit" | null>(null);

  // Pre-select the only usable policy and the current admission (with its doctor and diagnosis).
  const [prefilled, setPrefilled] = useState("");
  if (cover && prefilled !== cover.patient.id) {
    setPrefilled(cover.patient.id);
    const usable = cover.policies.filter((p) => p.usable);
    setPolicy(usable.length === 1 ? usable[0].id : "");
    const a = cover.admissions[0];
    setAdmission(a?.id ?? "");
    if (a?.doctor) {
      setDoctor(a.doctor);
      setDoctorKey((k) => k + 1);
    }
    if (a?.diagnosis) setForm((f) => (f.diagnosis ? f : { ...f, diagnosis: a.diagnosis! }));
  }

  const set = (k: keyof typeof form, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    if (errors[k]) setErrors((e) => omitKey(e, k));
  };
  const selected = cover?.policies.find((p) => p.id === policy);
  const requested = Number(form.requestedAmount || form.estimatedAmount || 0);

  async function save(submit: boolean) {
    setFormError(null);
    const errs: Record<string, string> = {};
    if (!patient) errs.patient = "Select the patient";
    if (!policy) errs.policy = "Select the policy";
    if (!admission && !planned) errs.admission = "Select the admission or enter the planned date";
    if (form.diagnosis.trim().length < 3) errs.diagnosis = "Enter the provisional diagnosis";
    if (!(Number(form.estimatedAmount) > 0)) errs.estimatedAmount = "Enter the estimated cost";
    setErrors(errs);
    if (Object.keys(errs).length) return setFormError("Please correct the highlighted fields.");
    setSaving(submit ? "submit" : "draft");
    try {
      const { data } = await api<{ id: string; code: string }>("/api/insurance/preauths", {
        method: "POST",
        body: { patient, policy, admission: admission || undefined, plannedAdmissionDate: admission ? undefined : planned, doctor: doctor?.id, ...form, submit },
      });
      toast(`Pre-auth ${data.code} ${submit ? "submitted" : "saved as draft"}`);
      router.push(`/insurance/preauth/${data.id}`);
    } catch (e) {
      if (e instanceof ApiClientError && e.fields) setErrors(e.fields);
      setFormError((e as Error).message);
      setSaving(null);
    }
  }
  useHotkeys({ "ctrl+s": () => save(false), F10: () => save(true) });

  const input = (k: keyof typeof form, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <input id={`pa-${k}`} value={form[k]} onChange={(e) => set(k, e.target.value)} className={cx(inputClass, errorRing(errors[k]))} {...props} />
  );

  return (
    <>
      <Link href="/m/insurance?tab=preauth" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="size-4" /> Back to pre-authorisations</Link>
      <h1 className="mb-1 text-xl font-semibold text-slate-900">New cashless pre-authorisation</h1>
      <p className="mb-5 text-sm text-slate-500">Request approval from the insurer / TPA before or at admission. Once approved, the IPD bill switches to insurance with the sanctioned limit.</p>
      {formError && <div className="mb-4"><Alert>{formError}</Alert></div>}
      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Card>
            <CardHeader title="Patient & policy" />
            <div className="space-y-4 p-5">
              <Field label="Patient" htmlFor="pa-patient" required error={errors.patient}>
                <RefSelect id="pa-patient" field={patientRef} value={patient} initial={initialPatient} className={cx(inputClass, errorRing(errors.patient))} onChange={(v) => { setPatient(v); setErrors((e) => omitKey(e, "patient")); }} />
              </Field>
              {coverError && <Alert>{coverError}</Alert>}
              {cover && <PolicyPicker cover={cover} value={policy} onChange={(v) => { setPolicy(v); setErrors((e) => omitKey(e, "policy")); }} error={errors.policy} />}
              {cover?.openPreauths.length ? <Alert tone="amber">Open pre-auth(s) for this patient: {cover.openPreauths.map((p) => `${p.code} (${p.status}${p.admissionCode ? `, ${p.admissionCode}` : ""})`).join(", ")}. Request an enhancement on the existing one if it is for the same admission.</Alert> : null}
            </div>
          </Card>
          <Card>
            <CardHeader title="Admission & treatment" />
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <Field label="Admission" htmlFor="pa-admission" required={!planned} error={errors.admission} hint={cover && !cover.admissions.length ? "Not admitted yet: enter the planned date" : undefined}>
                <select id="pa-admission" value={admission} onChange={(e) => setAdmission(e.target.value)} className={cx(inputClass, errorRing(errors.admission))} disabled={!cover}>
                  <option value="">{cover?.admissions.length ? "Planned admission (not admitted yet)" : "— Not admitted —"}</option>
                  {cover?.admissions.map((a) => <option key={a.id} value={a.id}>{a.code} · {formatDate(a.date)} · {a.ward} / {a.bed}</option>)}
                </select>
              </Field>
              {!admission && (
                <Field label="Planned admission date" htmlFor="pa-planned" required error={errors.plannedAdmissionDate}>
                  <input id="pa-planned" type="date" value={planned} onChange={(e) => setPlanned(e.target.value)} className={cx(inputClass, errorRing(errors.plannedAdmissionDate))} />
                </Field>
              )}
              <Field label="Treating doctor" htmlFor="pa-doctor" error={errors.doctor}>
                <RefSelect key={doctorKey} id="pa-doctor" field={doctorRef} value={doctor?.id ?? ""} initial={doctor ?? undefined} className={inputClass} onChange={() => {}} onPick={(o) => setDoctor(o)} />
              </Field>
              <Field label="Provisional diagnosis" htmlFor="pa-diagnosis" required error={errors.diagnosis} className="sm:col-span-2">{input("diagnosis", { maxLength: 300 })}</Field>
              <Field label="ICD-10 code" htmlFor="pa-icdCode" error={errors.icdCode}>{input("icdCode", { maxLength: 20, placeholder: "e.g. K35.8" })}</Field>
              <Field label="Line of treatment" htmlFor="pa-treatmentType" required error={errors.treatmentType}>
                <select id="pa-treatmentType" value={form.treatmentType} onChange={(e) => set("treatmentType", e.target.value)} className={inputClass}>
                  {TREATMENTS.map((t) => <option key={t}>{t}</option>)}
                </select>
              </Field>
              <Field label="Procedure / surgery" htmlFor="pa-procedure" error={errors.procedure} className="sm:col-span-2">{input("procedure", { maxLength: 200, placeholder: "e.g. Laparoscopic appendicectomy" })}</Field>
              <Field label="Expected stay (days)" htmlFor="pa-expectedStayDays" error={errors.expectedStayDays}>{input("expectedStayDays", { type: "number", min: 0, max: 365 })}</Field>
              <Field label="Room category" htmlFor="pa-roomCategory" error={errors.roomCategory}>
                <select id="pa-roomCategory" value={form.roomCategory} onChange={(e) => set("roomCategory", e.target.value)} className={inputClass}>
                  <option value="">— Not specified —</option>
                  {ROOMS.map((t) => <option key={t}>{t}</option>)}
                </select>
              </Field>
              <Field label="Notes for the insurer" htmlFor="pa-notes" className="sm:col-span-2">
                <textarea id="pa-notes" rows={2} maxLength={500} value={form.notes} onChange={(e) => set("notes", e.target.value)} className={inputClass} />
              </Field>
            </div>
          </Card>
        </div>
        <div className="space-y-5">
          <Card>
            <CardHeader title="Estimate" />
            <div className="space-y-4 p-5">
              <Field label="Estimated cost of treatment" htmlFor="pa-estimatedAmount" required error={errors.estimatedAmount}>{input("estimatedAmount", { type: "number", min: 0, inputMode: "decimal" })}</Field>
              <Field label="Amount requested from insurer" htmlFor="pa-requestedAmount" error={errors.requestedAmount} hint="Defaults to the estimate; lower it for co-pay or non-payables">{input("requestedAmount", { type: "number", min: 0, inputMode: "decimal" })}</Field>
              {selected && requested > selected.cover.available && <Alert tone="amber">Requested {formatMoney(requested)} is more than the {formatMoney(selected.cover.available)} still available on this policy. The excess will be the patient&apos;s.</Alert>}
              {selected?.copayPct ? <p className="text-xs text-slate-500">Co-pay {selected.copayPct}% ≈ {formatMoney((requested * selected.copayPct) / 100)} payable by the patient.</p> : null}
              <div className="flex flex-col gap-2 pt-2">
                <Button onClick={() => save(true)} loading={saving === "submit"} disabled={!!saving}><ShieldPlus className="size-4" /> Submit to insurer <Kbd>F10</Kbd></Button>
                <Button variant="secondary" onClick={() => save(false)} loading={saving === "draft"} disabled={!!saving}>Save as draft <Kbd>Ctrl+S</Kbd></Button>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
