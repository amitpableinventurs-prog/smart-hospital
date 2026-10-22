"use client";

import { useState } from "react";
import { ModulePicker } from "../ModulePicker";
import { Alert, Button, Field, Modal, errorRing, inputClass, omitKey } from "../ui";
import { ApiClientError } from "@/lib/client";
import type { PlanRow } from "@/lib/control-shared";
import type { ModuleKey } from "@/lib/modules";

type Values = { code: string; name: string; description: string; features: string; durationDays: string; price: string; gstPct: string; graceDays: string; maxUsers: string; sortOrder: string; trial: boolean; public: boolean; active: boolean };

const DURATIONS = [["30", "1 month"], ["90", "3 months"], ["180", "6 months"], ["365", "1 year"], ["730", "2 years"], ["1095", "3 years"]] as const;

/** Create or edit a subscription plan. */
export function PlanForm({ plan, onSubmit, onClose }: { plan?: PlanRow; onSubmit: (body: Record<string, unknown>) => Promise<void>; onClose: () => void }) {
  const [v, setV] = useState<Values>(() => ({
    code: plan?.code ?? "", name: plan?.name ?? "", description: plan?.description ?? "", features: (plan?.features ?? []).join("\n"),
    durationDays: String(plan?.durationDays ?? 365), price: plan ? String(plan.price) : "", gstPct: String(plan?.gstPct ?? 18), graceDays: String(plan?.graceDays ?? 15),
    maxUsers: String(plan?.maxUsers ?? 0), sortOrder: String(plan?.sortOrder ?? 0), trial: plan?.trial ?? false, public: plan?.public ?? true, active: plan?.active ?? true,
  }));
  const [modules, setModules] = useState<ModuleKey[]>(plan?.modules ?? []);
  const [applyToClients, setApplyToClients] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof Values) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setV((s) => ({ ...s, [k]: e.target.value }));
    if (errors[k]) setErrors((x) => omitKey(x, k));
  };
  const check = (k: "trial" | "public" | "active", label: string, hint: string) => (
    <label className="flex items-start gap-2 text-sm text-slate-700">
      <input type="checkbox" checked={v[k]} onChange={(e) => setV((s) => ({ ...s, [k]: e.target.checked }))} className="mt-0.5 size-4 accent-brand-600" />
      <span><span className="font-medium text-slate-900">{label}</span><span className="block text-xs text-slate-500">{hint}</span></span>
    </label>
  );

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        ...v, features: v.features, modules, durationDays: Number(v.durationDays), price: Number(v.price || 0), gstPct: Number(v.gstPct), graceDays: Number(v.graceDays),
        maxUsers: Number(v.maxUsers || 0), sortOrder: Number(v.sortOrder || 0), ...(plan && applyToClients ? { applyToClients: true } : {}),
      });
    } catch (err) {
      setError((err as Error).message);
      if (err instanceof ApiClientError && err.fields) setErrors(err.fields);
      setBusy(false);
    }
  }

  const input = (k: keyof Values, label: string, props: React.InputHTMLAttributes<HTMLInputElement> & { hint?: string; required?: boolean } = {}) => {
    const { hint, required, ...rest } = props;
    return (
      <Field label={label} htmlFor={`p-${k}`} required={required} error={errors[k]} hint={hint}>
        <input id={`p-${k}`} value={String(v[k])} onChange={set(k)} className={`${inputClass} ${errorRing(errors[k])}`} {...rest} />
      </Field>
    );
  };

  return (
    <Modal open onClose={onClose} size="xl" title={plan ? `Edit plan ${plan.name}` : "New plan"} description="What a hospital gets for how long, and the price before GST."
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button onClick={() => submit()} loading={busy}>{plan ? "Save" : "Create plan"}</Button></>}>
      <form onSubmit={submit} className="space-y-5" noValidate>
        {error && <Alert>{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-3">
          {input("name", "Plan name", { required: true, placeholder: "e.g. Standard" })}
          {input("code", "Code", { required: true, placeholder: "STANDARD", hint: "Short, unique; used in links and reports" })}
          {input("sortOrder", "Display order", { type: "number", hint: "Lower shows first" })}
        </div>
        <div className="grid gap-4 sm:grid-cols-5">
          <Field label="Duration" htmlFor="p-durationDays" required error={errors.durationDays}>
            <select id="p-durationDays" value={v.durationDays} onChange={set("durationDays")} className={inputClass}>
              {!DURATIONS.some(([d]) => d === v.durationDays) && <option value={v.durationDays}>{v.durationDays} days</option>}
              {DURATIONS.map(([d, l]) => <option key={d} value={d}>{l}</option>)}
            </select>
          </Field>
          {input("price", "Price (₹, before GST)", { type: "number", min: 0, required: true, hint: v.trial ? "Free trial: usually 0" : undefined })}
          <Field label="GST" htmlFor="p-gstPct" error={errors.gstPct}>
            <select id="p-gstPct" value={v.gstPct} onChange={set("gstPct")} className={inputClass}>{[0, 5, 12, 18, 28].map((g) => <option key={g} value={g}>{g}%</option>)}</select>
          </Field>
          {input("maxUsers", "Staff logins", { type: "number", min: 0, hint: "0 = unlimited" })}
          {input("graceDays", "Offline grace (days)", { type: "number", min: 1, max: 365 })}
        </div>
        <ModulePicker value={modules} onChange={(m) => { setModules(m); if (errors.modules) setErrors((x) => omitKey(x, "modules")); }} error={errors.modules} disabled={busy} label="Modules in this plan" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Short description" htmlFor="p-description" hint="Shown on the pricing page and the renewal screen">
            <textarea id="p-description" value={v.description} onChange={set("description")} rows={3} maxLength={300} className={inputClass} />
          </Field>
          <Field label="Highlights" htmlFor="p-features" hint="One per line, e.g. “Free installation & training”">
            <textarea id="p-features" value={v.features} onChange={set("features")} rows={3} className={inputClass} />
          </Field>
        </div>
        <div className="grid gap-3 rounded-lg bg-slate-50 p-4 ring-1 ring-slate-200 sm:grid-cols-3">
          {check("active", "On sale", "Off = existing clients keep it, nobody new can buy it")}
          {check("public", "Show publicly", "On the pricing page and in hospitals' renewal screen")}
          {check("trial", "Free-trial plan", "Offered on the setup screen without a licence key (only one plan)")}
        </div>
        {plan && plan.clients > 0 && (
          <label className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">
            <input type="checkbox" checked={applyToClients} onChange={(e) => setApplyToClients(e.target.checked)} className="mt-0.5 size-4 accent-brand-600" />
            <span>Apply modules, staff logins and grace period to the {plan.clients} client{plan.clients === 1 ? "" : "s"} on this plan now. Otherwise they get the changes at their next payment.</span>
          </label>
        )}
      </form>
    </Modal>
  );
}
