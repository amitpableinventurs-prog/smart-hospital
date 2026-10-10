"use client";

import { Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { ApiClientError, api, qs } from "@/lib/client";
import { useApiQuery } from "@/lib/useApi";
import { formatDateTime, formatValue } from "@/lib/format";
import type { FieldDef, ModuleDef, ResourceDef } from "@/lib/modules";
import { RecordFields, clientValidate, initialRefLabels, initialValues, toPayload, type FormValues } from "./RecordForm";
import { Alert, Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Modal, Pagination, Spinner, cx, inputClass, Kbd, omitKey, statusTone, useDebounced, useHotkeys, useToast } from "./ui";

type Row = Record<string, unknown> & { id: string; code?: string | null; updatedAt?: string };

export function ResourceManager({ module, resource }: { module: ModuleDef; resource: ResourceDef }) {
  const toast = useToast();
  const base = `/api/m/${module.key}/${resource.key}`;
  const statusField = resource.fields.find((f) => f.name === resource.statusField);
  const columns = useMemo(() => resource.fields.filter((f) => f.list), [resource]);

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const debounced = useDebounced(search);
  const query = useApiQuery<Row[]>(`${base}${qs({ search: debounced, [resource.statusField ?? "status"]: status, page, limit: 10 })}`);
  const { loading, error, pagination: paging } = query;
  const rows = query.data ?? [];
  const refresh = query.reload;

  const [editing, setEditing] = useState<Row | "new" | null>(null);
  const [deleting, setDeleting] = useState<Row | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const writable = !resource.readOnly;

  // F2 = new record, F3 = jump to search (disabled while a dialog is open).
  useHotkeys(
    {
      F2: () => writable && setEditing("new"),
      F3: () => searchRef.current?.focus(),
    },
    !editing && !deleting
  );

  async function confirmDelete() {
    if (!deleting) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await api(`${base}/${deleting.id}`, { method: "DELETE" });
      toast(`${resource.singular} deleted`);
      setDeleting(null);
      refresh();
    } catch (e) {
      setDeleteError((e as Error).message);
    } finally {
      setDeleteBusy(false);
    }
  }

  const filtered = !!(debounced || status);

  return (
    <Card>
      <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <input ref={searchRef} value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder={`Search ${resource.label.toLowerCase()}…  (F3)`} className={cx(inputClass, "pl-9")} aria-label={`Search ${resource.label}`} />
        </div>
        {statusField && (
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className={cx(inputClass, "sm:w-48")} aria-label="Filter by status">
            <option value="">All statuses</option>
            {statusField.options?.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        )}
        {writable && (
          <Button onClick={() => setEditing("new")}>
            <Plus className="size-4" /> New {resource.singular.toLowerCase()} <Kbd>F2</Kbd>
          </Button>
        )}
      </div>
      {!writable && (
        <p className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs text-slate-500">
          {resource.label} are maintained automatically by purchase entries and sale bills in the Pharmacy module.
        </p>
      )}

      {loading ? (
        <Spinner />
      ) : error ? (
        <ErrorState message={error} onRetry={refresh} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={filtered ? "No matching records" : `No ${resource.label.toLowerCase()} yet`}
          description={filtered ? "Try a different search or filter." : `Records you add will appear here.`}
          action={!filtered && writable && <Button onClick={() => setEditing("new")}><Plus className="size-4" /> Add {resource.singular.toLowerCase()}</Button>}
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead className="bg-slate-50/60">
              <tr>
                {resource.codePrefix && <Th>Ref #</Th>}
                {columns.map((c) => (
                  <Th key={c.name}>{c.label}</Th>
                ))}
                <Th>Last updated</Th>
                {writable && <th className="px-4 py-3"><span className="sr-only">Actions</span></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50/60">
                  {resource.codePrefix && <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-600">{row.code ?? "—"}</td>}
                  {columns.map((c) => (
                    <td key={c.name} className="whitespace-nowrap px-4 py-3 text-slate-700">
                      <Cell field={c} value={row[c.name]} isStatus={c.name === resource.statusField} />
                    </td>
                  ))}
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">{formatDateTime(row.updatedAt)}</td>
                  {writable && <td className="whitespace-nowrap px-4 py-3 text-right">
                    <button onClick={() => setEditing(row)} className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-brand-700" aria-label={`Edit ${resource.singular}`}>
                      <Pencil className="size-4" />
                    </button>
                    <button onClick={() => { setDeleteError(null); setDeleting(row); }} className="rounded p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600" aria-label={`Delete ${resource.singular}`}>
                      <Trash2 className="size-4" />
                    </button>
                  </td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!loading && !error && <Pagination pagination={paging} onPage={setPage} />}

      {editing && (
        <RecordModal
          key={editing === "new" ? "new" : editing.id}
          resource={resource}
          base={base}
          record={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(msg) => {
            toast(msg);
            setEditing(null);
            refresh();
          }}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        danger
        title={`Delete ${resource.singular.toLowerCase()}?`}
        message={<>This permanently removes <strong>{deleting ? String(deleting.code ?? formatValue(resource.fields.find((f) => f.name === resource.labelField) ?? resource.fields[0], deleting[resource.labelField])) : ""}</strong>. The deletion is recorded in the activity log.</>}
        confirmLabel="Delete"
        loading={deleteBusy}
        error={deleteError}
        onConfirm={confirmDelete}
        onClose={() => setDeleting(null)}
      />
    </Card>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">{children}</th>;
}

function Cell({ field, value, isStatus }: { field: FieldDef; value: unknown; isStatus: boolean }) {
  const text = formatValue(field, value);
  if ((isStatus || field.name === "priority" || field.name === "patientType") && text !== "—") return <Badge tone={statusTone(text)}>{text}</Badge>;
  return <span className="block max-w-[16rem] truncate" title={text}>{text}</span>;
}

export function RecordModal({ resource, base, record, onClose, onSaved }: { resource: ResourceDef; base: string; record: Row | null; onClose: () => void; onSaved: (message: string, saved: Row) => void }) {
  const initial = useMemo(() => initialValues(resource, record), [resource, record]);
  const [values, setValues] = useState<FormValues>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const refLabels = useMemo(() => initialRefLabels(resource, record), [resource, record]);
  useHotkeys({ "ctrl+s": () => save(), F10: () => save() });

  async function save(e?: React.FormEvent) {
    e?.preventDefault();
    setFormError(null);
    const clientErrors = clientValidate(resource, values);
    setErrors(clientErrors);
    if (Object.keys(clientErrors).length) {
      setFormError("Please correct the highlighted fields.");
      return;
    }
    setSaving(true);
    try {
      const { data } = record
        ? await api<Row>(`${base}/${record.id}`, { method: "PATCH", body: toPayload(resource, values, initial) })
        : await api<Row>(base, { method: "POST", body: toPayload(resource, values) });
      onSaved(record ? `${resource.singular} updated` : `${resource.singular} created${data.code ? ` (${data.code})` : ""}`, data);
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
      title={record ? `Edit ${resource.singular.toLowerCase()}` : `New ${resource.singular.toLowerCase()}`}
      description={record?.code ? String(record.code) : undefined}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={() => save()} loading={saving}>{record ? "Save changes" : `Create ${resource.singular.toLowerCase()}`} <Kbd>Ctrl+S</Kbd></Button>
        </>
      }
    >
      <form onSubmit={save} noValidate className="space-y-4">
        {formError && <Alert>{formError}</Alert>}
        <RecordFields
          resource={resource}
          values={values}
          errors={errors}
          refLabels={refLabels}
          disabled={saving}
          onChange={(name, v) => {
            setValues((s) => ({ ...s, [name]: v }));
            if (errors[name]) setErrors((e) => omitKey(e, name));
          }}
        />
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}
