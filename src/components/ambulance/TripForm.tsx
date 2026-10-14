"use client";

import { ArrowLeft, PhoneCall, Truck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiClientError, api } from "@/lib/client";
import { GENDERS, TRIP_TYPES } from "@/lib/modules";
import { useApiQuery } from "@/lib/useApi";
import { RefSelect, type RefOption } from "../RecordForm";
import { Alert, Button, Card, CardHeader, Field, Kbd, Spinner, cx, errorRing, inputClass, omitKey, useHotkeys, useToast } from "../ui";
import { DispatchFields, dispatchPayload, emptyDispatch, type Board, type DispatchValue } from "./Dispatch";

const patientRef = { name: "patient", label: "Registered patient", type: "ref" as const, ref: "patients.patients" };
const PRIORITIES = ["Critical", "Urgent", "Routine"];

/** "now" for a datetime-local input. */
function localNow() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Log an incoming ambulance call, optionally dispatching at once. */
export function TripForm({ initialPatient }: { initialPatient?: RefOption }) {
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState({
    tripType: "Emergency", priority: "Urgent", callerName: "", callerPhone: "", requestedAt: localNow(), patientName: "", patientAge: "", patientGender: "",
    condition: "", pickupLocation: "", pickupLandmark: "", dropLocation: "", notes: "",
  });
  const [patient, setPatient] = useState(initialPatient?.id ?? "");
  const [toHospital, setToHospital] = useState(true);
  const [dispatchNow, setDispatchNow] = useState(true);
  const [dispatch, setDispatch] = useState<DispatchValue>(emptyDispatch);
  const board = useApiQuery<Board>(dispatchNow ? "/api/ambulance/board" : null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof form, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    if (errors[k]) setErrors((e) => omitKey(e, k));
  };

  async function save() {
    setFormError(null);
    const errs: Record<string, string> = {};
    if (!form.callerPhone.trim()) errs.callerPhone = "Enter the caller's phone number";
    if (form.pickupLocation.trim().length < 3) errs.pickupLocation = "Enter the pickup address";
    if (dispatchNow && !dispatch.vehicle) errs.vehicle = "Select the ambulance, or untick “Dispatch now”";
    if (dispatchNow && !dispatch.driver) errs.driver = "Select the driver";
    setErrors(errs);
    if (Object.keys(errs).length) return setFormError("Please correct the highlighted fields.");
    setSaving(true);
    try {
      const { data } = await api<{ id: string; code: string }>("/api/ambulance/trips", {
        method: "POST",
        body: {
          ...form, requestedAt: new Date(form.requestedAt).toISOString(), patient: patient || undefined, toHospital,
          dispatch: dispatchNow ? dispatchPayload(dispatch) : undefined,
        },
      });
      toast(`Call ${data.code} logged${dispatchNow ? " and dispatched" : ""}`);
      router.push(`/ambulance/trips/${data.id}`);
    } catch (e) {
      if (e instanceof ApiClientError && e.fields) setErrors(e.fields);
      setFormError((e as Error).message);
      setSaving(false);
    }
  }
  useHotkeys({ "ctrl+s": save, F10: save });

  const input = (k: keyof typeof form, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <input id={`trip-${k}`} value={form[k]} onChange={(e) => set(k, e.target.value)} className={cx(inputClass, errorRing(errors[k]))} {...props} />
  );

  return (
    <>
      <Link href="/m/ambulance?tab=board" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="size-4" /> Back to dispatch board</Link>
      <h1 className="mb-5 text-xl font-semibold text-slate-900">New ambulance call</h1>
      {formError && <div className="mb-4"><Alert>{formError}</Alert></div>}
      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Card>
            <CardHeader title="Call" />
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <Field label="Trip type" htmlFor="trip-tripType" required error={errors.tripType}>
                <select id="trip-tripType" value={form.tripType} onChange={(e) => { set("tripType", e.target.value); setDispatch(emptyDispatch); }} className={inputClass}>
                  {TRIP_TYPES.map((t) => <option key={t}>{t}</option>)}
                </select>
              </Field>
              <Field label="Priority" htmlFor="trip-priority" required error={errors.priority}>
                <select id="trip-priority" value={form.priority} onChange={(e) => set("priority", e.target.value)} className={cx(inputClass, form.priority === "Critical" && "font-semibold text-red-700")}>
                  {PRIORITIES.map((t) => <option key={t}>{t}</option>)}
                </select>
              </Field>
              <Field label="Caller phone" htmlFor="trip-callerPhone" required error={errors.callerPhone}>{input("callerPhone", { type: "tel", autoFocus: true })}</Field>
              <Field label="Caller name" htmlFor="trip-callerName">{input("callerName", { maxLength: 120 })}</Field>
              <Field label="Call received at" htmlFor="trip-requestedAt" error={errors.requestedAt}>{input("requestedAt", { type: "datetime-local" })}</Field>
              <Field label="Condition / reason" htmlFor="trip-condition" error={errors.condition}>{input("condition", { maxLength: 500, placeholder: "e.g. chest pain, road accident, unconscious" })}</Field>
            </div>
          </Card>
          <Card>
            <CardHeader title="Patient & locations" />
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <Field label="Registered patient" htmlFor="trip-patient" error={errors.patient} hint="Needed to bill the patient's hospital account or open an emergency visit. Can be linked later." className="sm:col-span-2">
                <RefSelect id="trip-patient" field={patientRef} value={patient} initial={initialPatient} className={inputClass} onChange={setPatient} />
              </Field>
              {!patient && (
                <>
                  <Field label="Patient name (if not registered)" htmlFor="trip-patientName">{input("patientName", { maxLength: 120 })}</Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Age" htmlFor="trip-patientAge" error={errors.patientAge}>{input("patientAge", { type: "number", min: 0, max: 120 })}</Field>
                    <Field label="Gender" htmlFor="trip-patientGender">
                      <select id="trip-patientGender" value={form.patientGender} onChange={(e) => set("patientGender", e.target.value)} className={inputClass}>
                        <option value="">—</option>
                        {GENDERS.map((g) => <option key={g}>{g}</option>)}
                      </select>
                    </Field>
                  </div>
                </>
              )}
              <Field label="Pickup address" htmlFor="trip-pickupLocation" required error={errors.pickupLocation} className="sm:col-span-2">{input("pickupLocation", { maxLength: 200 })}</Field>
              <Field label="Landmark" htmlFor="trip-pickupLandmark">{input("pickupLandmark", { maxLength: 120 })}</Field>
              <Field label="Drop location" htmlFor="trip-dropLocation" hint={toHospital ? "Blank = this hospital" : undefined}>{input("dropLocation", { maxLength: 200 })}</Field>
              <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-2">
                <input type="checkbox" checked={toHospital} onChange={(e) => setToHospital(e.target.checked)} className="size-4 rounded border-slate-300 text-brand-600" />
                Patient is being brought to this hospital (an emergency visit can be opened on arrival)
              </label>
              <Field label="Notes" htmlFor="trip-notes" className="sm:col-span-2">
                <textarea id="trip-notes" rows={2} maxLength={500} value={form.notes} onChange={(e) => set("notes", e.target.value)} className={inputClass} />
              </Field>
            </div>
          </Card>
        </div>
        <div className="space-y-5">
          <Card>
            <CardHeader title="Dispatch" actions={<label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={dispatchNow} onChange={(e) => setDispatchNow(e.target.checked)} className="size-4 rounded border-slate-300 text-brand-600" /> Dispatch now</label>} />
            <div className="p-5">
              {!dispatchNow ? (
                <p className="text-sm text-slate-500">The call waits on the Dispatch Board until an ambulance is assigned.</p>
              ) : board.loading ? (
                <Spinner label="Checking fleet…" />
              ) : board.error ? (
                <Alert>{board.error}</Alert>
              ) : board.data ? (
                <DispatchFields board={board.data} value={dispatch} onChange={(v) => { setDispatch(v); setErrors((e) => omitKey(omitKey(e, "vehicle"), "driver")); }} errors={errors} tripType={form.tripType} />
              ) : null}
              <div className="mt-5 flex flex-col gap-2">
                <Button onClick={save} loading={saving}>{dispatchNow ? <><Truck className="size-4" /> Log & dispatch</> : <><PhoneCall className="size-4" /> Log call</>} <Kbd>F10</Kbd></Button>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
