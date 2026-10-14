"use client";

import { CircleCheck, ShieldCheck, Trash2 } from "lucide-react";
import { useState } from "react";
import { ApiClientError, api } from "@/lib/client";
import { formatDateTime } from "@/lib/format";
import { useApiQuery } from "@/lib/useApi";
import { Alert, Button, Card, CardHeader, ConfirmDialog, ErrorState, Field, Spinner, cx, errorRing, inputClass, useToast } from "../ui";
import { GatewayBadge } from "./Razorpay";

export interface GatewaySettings {
  configured: boolean;
  keyId: string | null;
  secretHint: string | null;
  mode: "test" | "live" | null;
  displayName: string;
  enabled: boolean;
  shared: boolean;
  verifiedAt: string | null;
  updatedAt: string | null;
  updatedByName: string | null;
}

/**
 * Razorpay keys for one owner — the signed-in admin, an admin edited by the
 * super admin, or the hospital account (`hospital` shows the sharing switch).
 */
export function GatewaySettingsCard({ url, title, description, hospital, className, onSaved }: { url: string; title: string; description: string; hospital?: boolean; className?: string; onSaved?: () => void }) {
  const q = useApiQuery<GatewaySettings>(url);
  return (
    <Card className={className}>
      <CardHeader title={title} description={description} actions={q.data?.configured ? <GatewayBadge mode={q.data.mode} /> : undefined} />
      {q.error ? <ErrorState message={q.error} onRetry={q.reload} /> : !q.data ? <Spinner label="Loading Razorpay settings…" /> : (
        <SettingsForm key={q.data.updatedAt ?? "new"} url={url} saved={q.data} hospital={hospital} onSaved={() => { q.reload(); onSaved?.(); }} />
      )}
    </Card>
  );
}

function SettingsForm({ url, saved, hospital, onSaved }: { url: string; saved: GatewaySettings; hospital?: boolean; onSaved: () => void }) {
  const toast = useToast();
  const [keyId, setKeyId] = useState(saved.keyId ?? "");
  const [keySecret, setKeySecret] = useState("");
  const [displayName, setDisplayName] = useState(saved.displayName);
  const [enabled, setEnabled] = useState(saved.configured ? saved.enabled : true);
  const [shared, setShared] = useState(saved.shared);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const keyChanged = keyId.trim() !== (saved.keyId ?? "");
  const dirty = keyChanged || !!keySecret || displayName !== saved.displayName || (saved.configured && (enabled !== saved.enabled || (hospital && shared !== saved.shared)));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!/^rzp_(test|live)_/.test(keyId.trim())) errs.keyId = "Key ID starts with rzp_test_ or rzp_live_";
    if ((keyChanged || !saved.configured) && !keySecret.trim()) errs.keySecret = "Enter the Key Secret";
    setErrors(errs);
    setFormError(null);
    if (Object.keys(errs).length) return;
    setSaving(true);
    try {
      await api(url, { method: "PUT", body: { keyId: keyId.trim(), keySecret: keySecret.trim(), displayName, enabled, ...(hospital ? { shared } : {}) } });
      toast(keySecret || keyChanged ? "Razorpay keys verified and saved" : "Razorpay settings saved");
      onSaved();
    } catch (err) {
      if (err instanceof ApiClientError && err.fields) setErrors(err.fields);
      setFormError((err as Error).message);
      setSaving(false);
    }
  }

  async function remove() {
    setRemoving(true);
    setRemoveError(null);
    try {
      await api(url, { method: "DELETE" });
      toast("Razorpay account removed");
      setConfirmRemove(false);
      onSaved();
    } catch (err) {
      setRemoveError((err as Error).message);
      setRemoving(false);
    }
  }

  return (
    <>
    <form onSubmit={submit} noValidate className="space-y-4 p-5">
      {formError && <Alert>{formError}</Alert>}
      {saved.configured && (
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
          <CircleCheck className="size-3.5 text-emerald-600" />
          {saved.enabled ? "Connected" : "Saved but switched off"}
          {saved.verifiedAt && ` · keys verified ${formatDateTime(saved.verifiedAt)}`}
          {saved.updatedByName && ` · last changed by ${saved.updatedByName}`}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Key ID" htmlFor="rzp-key" required error={errors.keyId}>
          <input id="rzp-key" value={keyId} autoComplete="off" spellCheck={false} placeholder="rzp_live_XXXXXXXXXXXXXX" onChange={(e) => setKeyId(e.target.value)} className={cx(inputClass, "font-mono", errorRing(errors.keyId))} />
        </Field>
        <Field label="Key Secret" htmlFor="rzp-secret" required={!saved.configured || keyChanged} error={errors.keySecret} hint={saved.configured && !keyChanged ? `Saved (${saved.secretHint}). Leave blank to keep it.` : "Stored encrypted; never shown again."}>
          <input id="rzp-secret" type="password" value={keySecret} autoComplete="new-password" spellCheck={false} onChange={(e) => setKeySecret(e.target.value)} className={cx(inputClass, "font-mono", errorRing(errors.keySecret))} />
        </Field>
      </div>
      <Field label="Business name on checkout" htmlFor="rzp-name" hint="Shown to the patient in the Razorpay window. Defaults to the hospital name.">
        <input id="rzp-name" value={displayName} maxLength={80} onChange={(e) => setDisplayName(e.target.value)} className={inputClass} />
      </Field>
      <div className="space-y-2">
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="mt-0.5 size-4 rounded border-slate-300 text-brand-600" />
          <span>Use this account for online payments</span>
        </label>
        {hospital && (
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} className="mt-0.5 size-4 rounded border-slate-300 text-brand-600" />
            <span>Admins without their own Razorpay account collect into this account<span className="block text-xs text-slate-500">Off: only admins who saved their own keys can take online payments.</span></span>
          </label>
        )}
      </div>
      <p className="flex items-start gap-1.5 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
        <ShieldCheck className="mt-px size-3.5 shrink-0 text-brand-600" />
        Get the keys in Razorpay Dashboard → Account &amp; Settings → API Keys. Test keys (rzp_test_) take no real money. The keys are checked with Razorpay before they are saved.
      </p>
      <div className="flex justify-between gap-2 border-t border-slate-100 pt-4">
        {saved.configured ? <Button type="button" variant="secondary" className="text-red-600" onClick={() => { setRemoveError(null); setConfirmRemove(true); }}><Trash2 className="size-4" /> Remove</Button> : <span />}
        <Button type="submit" loading={saving} disabled={saved.configured && !dirty}>{keySecret || keyChanged || !saved.configured ? "Verify & save" : "Save"}</Button>
      </div>
    </form>
    <ConfirmDialog open={confirmRemove} danger title="Remove Razorpay account?" confirmLabel="Remove"
        message="The saved keys are deleted. Payments already received stay in Razorpay and in the records; checkouts started but not finished on this account can no longer be checked."
        loading={removing} error={removeError} onConfirm={remove} onClose={() => setConfirmRemove(false)} />
    </>
  );
}
