"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { ModulePicker } from "../ModulePicker";
import { Alert, Button, Field, Modal, errorRing, inputClass, omitKey } from "../ui";
import { ApiClientError } from "@/lib/client";
import type { ModuleKey } from "@/lib/modules";

/** A licensed hospital as the Control Panel API returns it. */
export interface ClientRow {
  id: string;
  code: string;
  name: string;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  city: string | null;
  notes: string | null;
  keyLast4: string | null;
  modules: ModuleKey[];
  status: "Active" | "Suspended";
  expiresAt: string | null;
  graceDays: number;
  syncEnabled: boolean;
  notice: string | null;
  dbName: string;
  domain: string | null;
  dnsTarget: string | null;
  dnsCheck: { checkedAt: string; ok: boolean; found: string[]; message: string } | null;
  installed: boolean;
  activatedAt: string | null;
  activationHost: string | null;
  lastSeenAt: string | null;
  lastIp: string | null;
  lastVersion: string | null;
  lastHost: string | null;
  lastStats: Record<string, number | string | null> | null;
  lastSyncAt: string | null;
  synced: Record<string, { docs: number; lastAt: string }>;
  resyncRequestedAt: string | null;
  createdAt: string | null;
}

/** Online = checked in within the last 15 minutes (installations check in every 10). */
export const isOnline = (c: Pick<ClientRow, "lastSeenAt">) => !!c.lastSeenAt && Date.now() - new Date(c.lastSeenAt).getTime() < 15 * 60_000;
export const isExpired = (c: Pick<ClientRow, "expiresAt">) => !!c.expiresAt && new Date(c.expiresAt).getTime() < Date.now();

type Values = { name: string; city: string; contactName: string; contactPhone: string; contactEmail: string; expiresAt: string; graceDays: string; syncEnabled: boolean; domain: string; dnsTarget: string; notice: string; notes: string };

export function toValues(c?: ClientRow): Values {
  return {
    name: c?.name ?? "", city: c?.city ?? "", contactName: c?.contactName ?? "", contactPhone: c?.contactPhone ?? "", contactEmail: c?.contactEmail ?? "",
    expiresAt: c?.expiresAt?.slice(0, 10) ?? "", graceDays: String(c?.graceDays ?? 15), syncEnabled: c?.syncEnabled ?? true,
    domain: c?.domain ?? "", dnsTarget: c?.dnsTarget ?? "", notice: c?.notice ?? "", notes: c?.notes ?? "",
  };
}

/** Create or edit a client's licence and details. */
export function ClientForm({ client, onSubmit, onClose }: { client?: ClientRow; onSubmit: (body: Record<string, unknown>) => Promise<void>; onClose: () => void }) {
  const [v, setV] = useState<Values>(() => toValues(client));
  const [modules, setModules] = useState<ModuleKey[]>(client?.modules ?? []);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof Values) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setV((s) => ({ ...s, [k]: e.target.value }));
    if (errors[k]) setErrors((x) => omitKey(x, k));
  };

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ ...v, graceDays: Number(v.graceDays), modules });
    } catch (err) {
      setError((err as Error).message);
      if (err instanceof ApiClientError && err.fields) setErrors(err.fields);
      setBusy(false);
    }
  }

  const input = (k: keyof Values, label: string, props: React.InputHTMLAttributes<HTMLInputElement> & { hint?: string; required?: boolean } = {}) => {
    const { hint, required, ...rest } = props;
    return (
      <Field label={label} htmlFor={`c-${k}`} required={required} error={errors[k]} hint={hint}>
        <input id={`c-${k}`} value={String(v[k])} onChange={set(k)} className={`${inputClass} ${errorRing(errors[k])}`} {...rest} />
      </Field>
    );
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={client ? `Edit ${client.name}` : "New client"}
      description={client ? undefined : "Issues a licence key. The hospital enters it once in the Windows setup to activate."}
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button onClick={() => submit()} loading={busy}>{client ? "Save" : "Create & issue key"}</Button></>}
    >
      <form onSubmit={submit} className="space-y-5" noValidate>
        {error && <Alert>{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          {input("name", "Hospital name", { required: true, placeholder: "e.g. City Care Hospital" })}
          {input("city", "City")}
          {input("contactName", "Contact person")}
          {input("contactPhone", "Contact phone", { type: "tel" })}
          {input("contactEmail", "Contact email", { type: "email" })}
        </div>
        <ModulePicker value={modules} onChange={(m) => { setModules(m); if (errors.modules) setErrors((x) => omitKey(x, "modules")); }} error={errors.modules} disabled={busy} label="Licensed modules" />
        <div className="grid gap-4 sm:grid-cols-3">
          {input("expiresAt", "Licence valid until", { type: "date", hint: "Blank = no expiry" })}
          {input("graceDays", "Offline grace (days)", { type: "number", min: 1, max: 365, hint: "Locks if it cannot reach you this long" })}
          <Field label="Data upload" htmlFor="c-sync" hint="Copy of the hospital's data to this server">
            <label className="flex h-[38px] items-center gap-2 text-sm text-slate-700">
              <input id="c-sync" type="checkbox" checked={v.syncEnabled} onChange={(e) => setV((s) => ({ ...s, syncEnabled: e.target.checked }))} className="size-4 accent-brand-600" /> Upload to central database
            </label>
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {input("domain", "Custom domain", { placeholder: "e.g. his.cityhospital.com", hint: "Optional. The hospital's own address for the app" })}
          {input("dnsTarget", "Domain points to", { placeholder: "Public IP of their server, or a host name", hint: "Used for the DNS check" })}
        </div>
        <Field label="Notice shown in their app" htmlFor="c-notice" hint="e.g. a renewal reminder. Leave blank for none." error={errors.notice}>
          <textarea id="c-notice" value={v.notice} onChange={set("notice")} maxLength={300} rows={2} className={inputClass} />
        </Field>
        <Field label="Internal notes" htmlFor="c-notes">
          <textarea id="c-notes" value={v.notes} onChange={set("notes")} maxLength={1000} rows={2} className={inputClass} />
        </Field>
      </form>
    </Modal>
  );
}

/** Shows a just-issued licence key, which is not shown again. */
export function LicenceKeyModal({ name, licenceKey, onClose }: { name: string; licenceKey: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <Modal open onClose={onClose} size="md" title={`Licence key for ${name}`} description="Copy it now — for security it is not shown again. You can issue a new one at any time." footer={<Button onClick={onClose}>Done</Button>}>
      <div className="flex items-center gap-2">
        <code className="flex-1 rounded-lg bg-slate-100 px-4 py-3 text-center font-mono text-lg tracking-wider text-slate-900">{licenceKey}</code>
        <Button variant="secondary" onClick={() => navigator.clipboard?.writeText(licenceKey).then(() => setCopied(true))} aria-label="Copy licence key">
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        </Button>
      </div>
      <ol className="mt-4 list-decimal space-y-1 pl-5 text-sm text-slate-600">
        <li>On the hospital&apos;s server PC, run <b>SmartHospital-Setup.exe</b> and choose <b>Server</b>.</li>
        <li>When the app opens, enter this licence key and create the hospital&apos;s administrator.</li>
        <li>On other staff PCs, run the same setup and choose <b>Workstation</b> with the server&apos;s address.</li>
      </ol>
    </Modal>
  );
}
