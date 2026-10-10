"use client";

import { ArrowLeft, Ban, CircleCheck, KeyRound } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { moduleName } from "@/components/ActivityFeed";
import { ActivityLogView } from "@/components/ActivityLogView";
import { AdminStatus, type AdminRow } from "@/components/AdminStatus";
import { ModulePicker } from "@/components/ModulePicker";
import { Alert, Button, Card, CardHeader, ConfirmDialog, EmptyState, ErrorState, Field, Modal, Spinner, cx, errorRing, inputClass, useToast } from "@/components/ui";
import { ApiClientError, api } from "@/lib/client";
import { ACTION_LABELS, formatDateTime, timeAgo } from "@/lib/format";
import type { ModuleKey } from "@/lib/modules";
import { PASSWORD_MIN, validatePassword } from "@/lib/validation";

interface Detail {
  admin: AdminRow;
  stats: {
    actions7d: number;
    actions30d: number;
    byModule: { module: string; count: number }[];
    byAction: { action: string; count: number }[];
    lastFailedLoginAt: string | null;
  };
}

export default function AdminDetailPage() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);
  const [reload, setReload] = useState(0);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [modules, setModules] = useState<ModuleKey[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [toggling, setToggling] = useState(false);
  const [confirmToggle, setConfirmToggle] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);

  const refresh = useCallback(() => setReload((n) => n + 1), []);

  useEffect(() => {
    api<Detail>(`/api/admins/${id}`)
      .then(({ data }) => {
        setDetail(data);
        setName(data.admin.name);
        setPhone(data.admin.phone ?? "");
        setModules(data.admin.modules);
        setError(null);
      })
      .catch((e) => setError({ status: e instanceof ApiClientError ? e.status : 0, message: (e as Error).message }));
  }, [id, reload]);

  const back = (
    <Link href="/super-admin/admins" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
      <ArrowLeft className="size-4" /> Back to admins
    </Link>
  );
  if (error) return <>{back}<Card>{error.status === 404 ? <EmptyState title="Admin not found" /> : <ErrorState message={error.message} onRetry={refresh} />}</Card></>;
  if (!detail) return <>{back}<Spinner label="Loading admin…" /></>;

  const { admin, stats } = detail;
  const dirty = name !== admin.name || phone !== (admin.phone ?? "") || [...modules].sort().join() !== [...admin.modules].sort().join();

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (name.trim().length < 2) errs.name = "Enter the admin's full name";
    if (modules.length === 0) errs.modules = "Select at least one module";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    setSaveError(null);
    try {
      const { data } = await api<AdminRow>(`/api/admins/${id}`, { method: "PATCH", body: { name, phone, modules } });
      setDetail((d) => (d ? { ...d, admin: { ...data, actions7d: d.admin.actions7d } } : d));
      toast("Admin access updated");
    } catch (err) {
      if (err instanceof ApiClientError && err.fields) setErrors(err.fields);
      setSaveError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive() {
    setToggling(true);
    setToggleError(null);
    try {
      const { data } = await api<AdminRow>(`/api/admins/${id}`, { method: "PATCH", body: { active: !admin.active } });
      setDetail((d) => (d ? { ...d, admin: { ...data, actions7d: d.admin.actions7d } } : d));
      toast(data.active ? "Admin activated" : "Admin deactivated and signed out");
      setConfirmToggle(false);
    } catch (err) {
      setToggleError((err as Error).message);
    } finally {
      setToggling(false);
    }
  }

  const maxModule = Math.max(1, ...stats.byModule.map((m) => m.count));

  return (
    <>
      {back}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{admin.name}</h1>
            <AdminStatus admin={admin} />
          </div>
          <p className="mt-1 text-sm text-slate-500">{admin.email}{admin.createdAt && ` · Admin since ${formatDateTime(admin.createdAt)}`}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setResetOpen(true)}><KeyRound className="size-4" /> Reset password</Button>
          <Button variant={admin.active ? "danger" : "primary"} onClick={() => { setToggleError(null); setConfirmToggle(true); }}>
            {admin.active ? <><Ban className="size-4" /> Deactivate</> : <><CircleCheck className="size-4" /> Activate</>}
          </Button>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Profile & module allocation" description="Changes take effect immediately — the admin's panels update on their next page load." />
          <form onSubmit={save} noValidate className="space-y-5 p-5">
            {saveError && <Alert>{saveError}</Alert>}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Full name" htmlFor="d-name" required error={errors.name}>
                <input id="d-name" value={name} onChange={(e) => setName(e.target.value)} className={cx(inputClass, errorRing(errors.name))} maxLength={120} />
              </Field>
              <Field label="Phone" htmlFor="d-phone" error={errors.phone}>
                <input id="d-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={cx(inputClass, errorRing(errors.phone))} />
              </Field>
            </div>
            <ModulePicker value={modules} onChange={setModules} error={errors.modules} disabled={saving} />
            <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
              <Button type="button" variant="secondary" disabled={!dirty || saving} onClick={() => { setName(admin.name); setPhone(admin.phone ?? ""); setModules(admin.modules); setErrors({}); }}>
                Discard
              </Button>
              <Button type="submit" loading={saving} disabled={!dirty}>Save changes</Button>
            </div>
          </form>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Monitoring" />
            <dl className="grid grid-cols-2 gap-4 p-5">
              <Stat label="Operations (7d)" value={stats.actions7d} />
              <Stat label="Operations (30d)" value={stats.actions30d} />
              <Stat label="Last sign-in" value={admin.lastLoginAt ? timeAgo(admin.lastLoginAt) : "Never"} sub={admin.lastLoginIp ? `from ${admin.lastLoginIp}` : undefined} />
              <Stat label="Last active" value={timeAgo(admin.lastActiveAt)} />
              <Stat label="Last failed sign-in" value={stats.lastFailedLoginAt ? timeAgo(stats.lastFailedLoginAt) : "None"} wide />
            </dl>
          </Card>
          <Card>
            <CardHeader title="Work by module" description="Last 30 days" />
            <div className="space-y-3 p-5">
              {stats.byModule.length === 0 ? (
                <p className="text-sm text-slate-500">No module activity yet.</p>
              ) : (
                stats.byModule.map((m) => (
                  <div key={m.module}>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-700">{moduleName(m.module)}</span>
                      <span className="tabular-nums text-slate-900">{m.count}</span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-slate-100">
                      <div className="h-1.5 rounded-full bg-brand-500" style={{ width: `${(m.count / maxModule) * 100}%` }} />
                    </div>
                  </div>
                ))
              )}
              {stats.byAction.length > 0 && (
                <p className="border-t border-slate-100 pt-3 text-xs text-slate-500">
                  {stats.byAction.map((a) => `${ACTION_LABELS[a.action] ?? a.action}: ${a.count}`).join(" · ")}
                </p>
              )}
            </div>
          </Card>
        </div>
      </div>

      <h2 className="mb-3 mt-8 text-lg font-semibold text-slate-900">Activity history</h2>
      <ActivityLogView actor={id} />

      <ConfirmDialog
        open={confirmToggle}
        danger={admin.active}
        title={admin.active ? "Deactivate admin?" : "Activate admin?"}
        message={admin.active ? <><strong>{admin.name}</strong> will be signed out immediately and cannot sign in until reactivated. Their records and history are kept.</> : <><strong>{admin.name}</strong> will be able to sign in again with their existing password.</>}
        confirmLabel={admin.active ? "Deactivate" : "Activate"}
        loading={toggling}
        error={toggleError}
        onConfirm={toggleActive}
        onClose={() => setConfirmToggle(false)}
      />
      {resetOpen && <ResetPasswordModal adminId={id} adminName={admin.name} onClose={() => setResetOpen(false)} onDone={() => { setResetOpen(false); toast("Password reset. The admin's sessions were signed out."); }} />}
    </>
  );
}

function Stat({ label, value, sub, wide }: { label: string; value: React.ReactNode; sub?: string; wide?: boolean }) {
  return (
    <div className={wide ? "col-span-2" : undefined}>
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">{value}</dd>
      {sub && <dd className="font-mono text-xs text-slate-500">{sub}</dd>}
    </div>
  );
}

function ResetPasswordModal({ adminId, adminName, onClose, onDone }: { adminId: string; adminName: string; onClose: () => void; onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    const pw = validatePassword(password);
    if (pw) return setError(pw);
    if (password !== confirm) return setError("Passwords do not match");
    setSaving(true);
    setError(null);
    try {
      await api(`/api/admins/${adminId}/password`, { method: "POST", body: { password } });
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title="Reset password"
      description={`Set a new password for ${adminName}. They will be signed out everywhere.`}
      footer={<><Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button><Button onClick={() => submit()} loading={saving}>Reset password</Button></>}
    >
      <form onSubmit={submit} noValidate className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <Field label="New password" htmlFor="r-pw" required hint={`At least ${PASSWORD_MIN} characters with letters and numbers.`}>
          <input id="r-pw" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Confirm password" htmlFor="r-pw2" required>
          <input id="r-pw2" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={inputClass} />
        </Field>
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}
