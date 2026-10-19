"use client";

import { KeyRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button, Field, errorRing, inputClass } from "@/components/ui";
import { ApiClientError, api } from "@/lib/client";

export function SetupForm({ needsAdmin, controlUrl }: { needsAdmin: boolean; controlUrl: string | null }) {
  const router = useRouter();
  const [v, setV] = useState({ licenceKey: "", name: "", email: "", password: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV((s) => ({ ...s, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setErrors({});
    try {
      const { data } = await api<{ hospitalName: string }>("/api/licence/activate", {
        method: "POST",
        body: { licenceKey: v.licenceKey, ...(needsAdmin ? { admin: { name: v.name, email: v.email, password: v.password } } : {}) },
      });
      setDone(data.hospitalName);
      setTimeout(() => router.replace("/login"), 1500);
    } catch (err) {
      setError((err as Error).message);
      if (err instanceof ApiClientError && err.fields) setErrors(err.fields);
      setBusy(false);
    }
  }

  if (done) return <div className="mt-8"><Alert tone="green">Activated for {done}. Opening sign in…</Alert></div>;
  return (
    <form onSubmit={submit} className="mt-8 space-y-4" noValidate>
      {!controlUrl && <Alert tone="amber">This installation has no licence server configured (CONTROL_URL). Reinstall with the setup from your vendor.</Alert>}
      {error && <Alert>{error}</Alert>}
      <Field label="Licence key" htmlFor="licenceKey" required error={errors.licenceKey}>
        <div className="relative">
          <KeyRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <input id="licenceKey" value={v.licenceKey} onChange={set("licenceKey")} placeholder="XXXXX-XXXXX-XXXXX-XXXXX" autoComplete="off" spellCheck={false} className={`${inputClass} pl-9 font-mono uppercase ${errorRing(errors.licenceKey)}`} />
        </div>
      </Field>
      {needsAdmin && (
        <>
          <p className="pt-2 text-sm font-medium text-slate-800">Hospital administrator</p>
          <p className="-mt-3 text-xs text-slate-500">This account is the super admin of this hospital: it creates the other staff logins and assigns their modules.</p>
          <Field label="Name" htmlFor="name" required error={errors["admin.name"]}><input id="name" value={v.name} onChange={set("name")} className={`${inputClass} ${errorRing(errors["admin.name"])}`} /></Field>
          <Field label="Email" htmlFor="email" required error={errors["admin.email"]}><input id="email" type="email" autoComplete="username" value={v.email} onChange={set("email")} className={`${inputClass} ${errorRing(errors["admin.email"])}`} /></Field>
          <Field label="Password" htmlFor="password" required error={errors["admin.password"]} hint="At least 8 characters"><input id="password" type="password" autoComplete="new-password" value={v.password} onChange={set("password")} className={`${inputClass} ${errorRing(errors["admin.password"])}`} /></Field>
        </>
      )}
      <Button type="submit" loading={busy} disabled={!controlUrl} className="w-full py-2.5">{busy ? "Activating…" : "Activate"}</Button>
    </form>
  );
}
