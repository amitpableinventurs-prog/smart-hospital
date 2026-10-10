"use client";

import { Search, UserPlus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { AdminStatus, type AdminRow } from "@/components/AdminStatus";
import { ModulePicker } from "@/components/ModulePicker";
import { Alert, Badge, Button, Card, EmptyState, ErrorState, Field, Modal, PageHeader, Pagination, Spinner, cx, errorRing, inputClass, omitKey, useDebounced, useToast } from "@/components/ui";
import { ApiClientError, api, qs } from "@/lib/client";
import { useApiQuery } from "@/lib/useApi";
import { formatDateTime, timeAgo } from "@/lib/format";
import { MODULES, MODULE_MAP, type ModuleKey } from "@/lib/modules";
import { PASSWORD_MIN, isValidEmail, validatePassword } from "@/lib/validation";

export default function AdminsPage() {
  const [search, setSearch] = useState("");
  const [moduleFilter, setModuleFilter] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const debounced = useDebounced(search);
  const list = useApiQuery<AdminRow[]>(`/api/admins${qs({ search: debounced, module: moduleFilter, status, page })}`);
  const { loading, error, pagination: paging } = list;
  const rows = list.data ?? [];
  const [creating, setCreating] = useState(false);

  const filtered = !!(debounced || moduleFilter || status);

  return (
    <>
      <PageHeader
        title="Admins & Access"
        description="Create admins, allocate the modules they manage, and control their access."
        actions={<Button onClick={() => setCreating(true)}><UserPlus className="size-4" /> New admin</Button>}
      />
      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 md:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search by name, email or phone…" className={cx(inputClass, "pl-9")} aria-label="Search admins" />
          </div>
          <select value={moduleFilter} onChange={(e) => { setModuleFilter(e.target.value); setPage(1); }} className={cx(inputClass, "md:w-52")} aria-label="Filter by module">
            <option value="">All modules</option>
            {MODULES.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className={cx(inputClass, "md:w-40")} aria-label="Filter by status">
            <option value="">Any status</option>
            <option value="active">Active</option>
            <option value="inactive">Deactivated</option>
          </select>
        </div>

        {loading ? (
          <Spinner label="Loading admins…" />
        ) : error ? (
          <ErrorState message={error} onRetry={list.reload} />
        ) : rows.length === 0 ? (
          <EmptyState
            title={filtered ? "No admins match" : "No admins yet"}
            description={filtered ? "Try a different search or filter." : "Create an admin for each department and allocate the modules they will manage."}
            action={!filtered && <Button onClick={() => setCreating(true)}><UserPlus className="size-4" /> Create first admin</Button>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead className="bg-slate-50/60">
                <tr>
                  {["Admin", "Allocated modules", "Status", "Last sign-in", "Last active", "Ops (7d)"].map((h) => (
                    <th key={h} className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((a) => (
                  <tr key={a.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3">
                      <Link href={`/super-admin/admins/${a.id}`} className="font-medium text-slate-900 hover:text-brand-700">{a.name}</Link>
                      <p className="text-xs text-slate-500">{a.email}</p>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex max-w-md flex-wrap gap-1">
                        {a.modules.length === MODULES.length ? <Badge tone="blue">All modules</Badge> : a.modules.map((m) => <Badge key={m} tone="blue">{MODULE_MAP[m].label}</Badge>)}
                      </div>
                    </td>
                    <td className="px-4 py-3"><AdminStatus admin={a} /></td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">{a.lastLoginAt ? formatDateTime(a.lastLoginAt) : <span className="text-slate-400">Never</span>}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">{timeAgo(a.lastActiveAt)}</td>
                    <td className="px-4 py-3 tabular-nums text-slate-900">{a.actions7d ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!loading && !error && <Pagination pagination={paging} onPage={setPage} />}
      </Card>

      {creating && <CreateAdminModal onClose={() => setCreating(false)} onCreated={() => { setCreating(false); list.reload(); }} />}
    </>
  );
}

function CreateAdminModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ name: "", email: "", phone: "", password: "" });
  const [modules, setModules] = useState<ModuleKey[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    if (errors[k]) setErrors((e) => omitKey(e, k));
  };

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    const errs: Record<string, string> = {};
    if (form.name.trim().length < 2) errs.name = "Enter the admin's full name";
    if (!isValidEmail(form.email)) errs.email = "Enter a valid email address";
    const pw = validatePassword(form.password);
    if (pw) errs.password = pw;
    if (modules.length === 0) errs.modules = "Select at least one module";
    setErrors(errs);
    setFormError(Object.keys(errs).length ? "Please correct the highlighted fields." : null);
    if (Object.keys(errs).length) return;

    setSaving(true);
    try {
      await api("/api/admins", { method: "POST", body: { ...form, modules } });
      toast(`Admin ${form.name.trim()} created`);
      onCreated();
    } catch (err) {
      if (err instanceof ApiClientError && err.fields) setErrors(err.fields);
      setFormError((err as Error).message);
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="New admin"
      description="The admin signs in with this email and password and only sees the modules you allocate."
      size="xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={() => submit()} loading={saving}>Create admin</Button>
        </>
      }
    >
      <form onSubmit={submit} noValidate className="space-y-5">
        {formError && <Alert>{formError}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" htmlFor="a-name" required error={errors.name}>
            <input id="a-name" value={form.name} onChange={set("name")} className={cx(inputClass, errorRing(errors.name))} maxLength={120} />
          </Field>
          <Field label="Email (sign-in ID)" htmlFor="a-email" required error={errors.email}>
            <input id="a-email" type="email" value={form.email} onChange={set("email")} className={cx(inputClass, errorRing(errors.email))} autoComplete="off" />
          </Field>
          <Field label="Phone" htmlFor="a-phone" error={errors.phone}>
            <input id="a-phone" type="tel" value={form.phone} onChange={set("phone")} className={cx(inputClass, errorRing(errors.phone))} />
          </Field>
          <Field label="Initial password" htmlFor="a-pw" required error={errors.password} hint={`At least ${PASSWORD_MIN} characters with letters and numbers. Share it securely.`}>
            <input id="a-pw" type="password" value={form.password} onChange={set("password")} className={cx(inputClass, errorRing(errors.password))} autoComplete="new-password" />
          </Field>
        </div>
        <ModulePicker value={modules} onChange={(m) => { setModules(m); if (errors.modules) setErrors((e) => omitKey(e, "modules")); }} error={errors.modules} disabled={saving} />
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}
