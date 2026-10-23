"use client";

import { Check, Copy, Gift, KeyRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button, Field, cx, errorRing, inputClass } from "@/components/ui";
import { ApiClientError, api } from "@/lib/client";

type Mode = "key" | "trial";
const EMPTY = { licenceKey: "", name: "", email: "", password: "", hospitalName: "", contactName: "", phone: "", hospitalEmail: "", city: "", referralCode: "" };

export function SetupForm({ needsAdmin, controlUrl }: { needsAdmin: boolean; controlUrl: string | null }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("key");
  const [v, setV] = useState(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ hospitalName: string; licenceKey?: string; trialEndsAt?: string | null; plan?: string | null } | null>(null);
  const [copied, setCopied] = useState(false);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV((s) => ({ ...s, [k]: e.target.value }));
  // An offline key (SH1.…) is the signed licence itself: no licence server needed.
  const offlineKey = mode === "key" && v.licenceKey.trim().startsWith("SH1.");
  const canSubmit = !!controlUrl || offlineKey;
  const admin = needsAdmin ? { admin: { name: v.name, email: v.email, password: v.password } } : {};

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setErrors({});
    try {
      if (mode === "key") {
        const { data } = await api<{ hospitalName: string }>("/api/licence/activate", { method: "POST", body: { licenceKey: v.licenceKey, ...admin } });
        setDone(data);
        setTimeout(() => router.replace("/login"), 1500);
      } else {
        const { data } = await api<{ hospitalName: string; licenceKey: string; trialEndsAt: string | null; plan: string | null }>("/api/licence/trial", {
          method: "POST",
          body: { hospital: { hospitalName: v.hospitalName, contactName: v.contactName, phone: v.phone, email: v.hospitalEmail, city: v.city, referralCode: v.referralCode }, ...admin },
        });
        setDone(data);
      }
    } catch (err) {
      setError((err as Error).message);
      if (err instanceof ApiClientError && err.fields) setErrors(err.fields);
      setBusy(false);
    }
  }

  const input = (k: keyof typeof v, label: string, errKey: string, props: React.InputHTMLAttributes<HTMLInputElement> & { hint?: string; required?: boolean } = {}) => {
    const { hint, required, ...rest } = props;
    return (
      <Field label={label} htmlFor={k} required={required} error={errors[errKey]} hint={hint}>
        <input id={k} value={v[k]} onChange={set(k)} className={`${inputClass} ${errorRing(errors[errKey])}`} {...rest} />
      </Field>
    );
  };

  if (done) {
    if (!done.licenceKey) return <div className="mt-8"><Alert tone="green">Activated for {done.hospitalName}. Opening sign in…</Alert></div>;
    return (
      <div className="mt-8 space-y-4">
        <Alert tone="green">Your free trial{done.plan ? ` (${done.plan})` : ""} has started for {done.hospitalName}{done.trialEndsAt ? ` and runs until ${done.trialEndsAt.slice(0, 10)}` : ""}.</Alert>
        <div>
          <p className="text-sm font-medium text-slate-800">Your licence key</p>
          <p className="text-xs text-slate-500">Write it down: you need it if this server PC is ever reinstalled. Choose a plan any time under Licence &amp; Sync.</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 rounded-lg bg-slate-100 px-4 py-3 text-center font-mono tracking-wider text-slate-900">{done.licenceKey}</code>
            <Button variant="secondary" onClick={() => navigator.clipboard?.writeText(done.licenceKey!).then(() => setCopied(true))} aria-label="Copy licence key">{copied ? <Check className="size-4" /> : <Copy className="size-4" />}</Button>
          </div>
        </div>
        <Button className="w-full py-2.5" onClick={() => router.replace("/login")}>Continue to sign in</Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
      {!controlUrl && <Alert tone="amber">This installation works without a licence server. Paste the offline licence key from your vendor (it starts with SH1.).</Alert>}
      {controlUrl && <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1" role="tablist">
        {([["key", "I have a licence key", KeyRound], ["trial", "Start a free trial", Gift]] as const).map(([m, label, Icon]) => (
          <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => { setMode(m); setError(null); setErrors({}); }}
            className={cx("inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium", mode === m ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900")}>
            <Icon className="size-4" /> {label}
          </button>
        ))}
      </div>}
      {error && <Alert>{error}</Alert>}
      {mode === "key" ? (
        <Field label="Licence key" htmlFor="licenceKey" required error={errors.licenceKey}>
          <div className="relative">
            <KeyRound className="pointer-events-none absolute left-3 top-3 size-4 text-slate-400" aria-hidden />
            <textarea id="licenceKey" value={v.licenceKey} onChange={set("licenceKey")} placeholder={controlUrl ? "XXXXX-XXXXX-XXXXX-XXXXX  or an offline key SH1.…" : "SH1.…"} rows={offlineKey ? 5 : 1} autoComplete="off" spellCheck={false}
              className={cx(inputClass, "resize-none pl-9 font-mono", offlineKey ? "break-all text-xs" : "uppercase placeholder:normal-case", errorRing(errors.licenceKey))} />
          </div>
        </Field>
      ) : (
        <>
          <p className="text-sm text-slate-600">Try every module of the trial plan free. No payment now — choose a plan from inside the app when you are ready.</p>
          {input("hospitalName", "Hospital name", "hospital.hospitalName", { required: true })}
          <div className="grid gap-4 sm:grid-cols-2">
            {input("contactName", "Your name", "hospital.contactName", { required: true })}
            {input("phone", "Mobile", "hospital.phone", { required: true, type: "tel", inputMode: "tel" })}
            {input("hospitalEmail", "Email", "hospital.email", { required: true, type: "email" })}
            {input("city", "City", "hospital.city")}
          </div>
          {input("referralCode", "Referral code", "hospital.referralCode", { hint: "Optional — from the partner who introduced you", className: `${inputClass} font-mono uppercase ${errorRing(errors["hospital.referralCode"])}` })}
        </>
      )}
      {needsAdmin && (
        <>
          <p className="pt-2 text-sm font-medium text-slate-800">Hospital administrator</p>
          <p className="-mt-3 text-xs text-slate-500">This account is the super admin of this hospital: it creates the other staff logins and assigns their modules.</p>
          {input("name", "Name", "admin.name", { required: true })}
          {input("email", "Email", "admin.email", { required: true, type: "email", autoComplete: "username" })}
          {input("password", "Password", "admin.password", { required: true, type: "password", autoComplete: "new-password", hint: "At least 8 characters" })}
        </>
      )}
      <Button type="submit" loading={busy} disabled={!canSubmit} className="w-full py-2.5">{busy ? (mode === "key" ? "Activating…" : "Starting trial…") : mode === "key" ? "Activate" : "Start free trial"}</Button>
      <p className="text-center text-xs text-slate-500">{offlineKey || !controlUrl ? "An offline key needs no internet." : "Needs the internet once; after that the app also works offline."}</p>
    </form>
  );
}
