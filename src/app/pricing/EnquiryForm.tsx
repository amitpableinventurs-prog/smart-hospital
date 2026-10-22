"use client";

import { useState } from "react";
import { Alert, Button, Field, errorRing, inputClass } from "@/components/ui";
import { ApiClientError, api } from "@/lib/client";

const EMPTY = { hospitalName: "", contactName: "", phone: "", email: "", city: "", beds: "", plan: "", message: "", company: "" };

/** "Request a demo": becomes a lead on the Control Panel. */
export function EnquiryForm({ plans }: { plans: { code: string; name: string }[] }) {
  const [v, setV] = useState(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV((s) => ({ ...s, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setErrors({});
    try {
      await api("/api/control/enquiry", { method: "POST", body: v });
      setSent(true);
    } catch (err) {
      setError((err as Error).message);
      if (err instanceof ApiClientError && err.fields) setErrors(err.fields);
    } finally {
      setBusy(false);
    }
  }

  if (sent) return <Alert tone="green">Thank you! We have received your request and will call you shortly.</Alert>;
  const input = (k: keyof typeof v, label: string, props: React.InputHTMLAttributes<HTMLInputElement> & { required?: boolean } = {}) => {
    const { required, ...rest } = props;
    return (
      <Field label={label} htmlFor={`e-${k}`} required={required} error={errors[k]}>
        <input id={`e-${k}`} value={v[k]} onChange={set(k)} className={`${inputClass} ${errorRing(errors[k])}`} {...rest} />
      </Field>
    );
  };
  return (
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
      {error && <div className="sm:col-span-2"><Alert>{error}</Alert></div>}
      <div className="sm:col-span-2">{input("hospitalName", "Hospital name", { required: true })}</div>
      {input("contactName", "Your name", { required: true })}
      {input("phone", "Mobile", { required: true, type: "tel", inputMode: "tel" })}
      {input("email", "Email", { type: "email" })}
      {input("city", "City")}
      {input("beds", "Number of beds", { type: "number", min: 0 })}
      <Field label="Interested in" htmlFor="e-plan">
        <select id="e-plan" value={v.plan} onChange={set("plan")} className={inputClass}>
          <option value="">Not sure yet</option>
          {plans.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
        </select>
      </Field>
      <Field label="Message" htmlFor="e-message" className="sm:col-span-2">
        <textarea id="e-message" value={v.message} onChange={set("message")} rows={3} maxLength={1000} className={inputClass} />
      </Field>
      {/* Left empty by people; bots fill it in. */}
      <input type="text" name="company" value={v.company} onChange={set("company")} tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
      <div className="sm:col-span-2"><Button type="submit" loading={busy} className="w-full py-2.5 sm:w-auto">Request a demo</Button></div>
    </form>
  );
}
