"use client";

import { ChevronDown, LoaderCircle, Search, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { api } from "@/lib/client";
import { toInputValue } from "@/lib/format";
import { resolveRef, type FieldDef, type ResourceDef } from "@/lib/modules";
import { validateRecord } from "@/lib/validation";
import { Field, cx, errorRing, inputClass } from "./ui";

export type FormValues = Record<string, string>;
export interface RefOption {
  id: string;
  label: string;
  code?: string;
  sub?: string;
}

export function initialValues(resource: ResourceDef, record?: Record<string, unknown> | null): FormValues {
  const out: FormValues = {};
  for (const f of resource.fields) {
    out[f.name] = record ? toInputValue(f, record[f.name]) : f.default !== undefined ? String(f.default) : "";
  }
  return out;
}

/** Labels of already-selected refs, so pickers can show names when editing. */
export function initialRefLabels(resource: ResourceDef, record?: Record<string, unknown> | null) {
  const out: Record<string, RefOption> = {};
  if (!record) return out;
  for (const f of resource.fields) {
    const v = record[f.name] as RefOption | null;
    if (f.type === "ref" && v && typeof v === "object") out[f.name] = v;
  }
  return out;
}

/** Turn form strings into the API payload (datetime-local → ISO, blanks → null). */
export function toPayload(resource: ResourceDef, values: FormValues, onlyChanged?: FormValues) {
  const payload: Record<string, unknown> = {};
  for (const f of resource.fields) {
    if (f.readOnly) continue;
    const v = values[f.name] ?? "";
    if (onlyChanged && onlyChanged[f.name] === v) continue;
    if (v.trim() === "") payload[f.name] = null;
    else if (f.type === "datetime") payload[f.name] = new Date(v).toISOString();
    else payload[f.name] = v;
  }
  return payload;
}

export function clientValidate(resource: ResourceDef, values: FormValues) {
  return validateRecord(resource, toPayload(resource, values)).errors;
}

export function RecordFields({
  resource,
  values,
  errors,
  onChange,
  refLabels,
  disabled,
}: {
  resource: ResourceDef;
  values: FormValues;
  errors: Record<string, string>;
  onChange: (name: string, value: string) => void;
  refLabels?: Record<string, RefOption>;
  disabled?: boolean;
}) {
  const formId = useId();
  return (
    <div className="grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2">
      {resource.fields.map((f) => {
        const id = `${formId}-${f.name}`;
        return (
          <Field key={f.name} label={f.label} htmlFor={id} required={f.required && !f.readOnly} error={errors[f.name]} hint={f.hint} className={f.wide ? "sm:col-span-2" : undefined}>
            <FieldInput id={id} field={f} value={values[f.name] ?? ""} error={errors[f.name]} onChange={(v) => onChange(f.name, v)} initialRef={refLabels?.[f.name]} disabled={disabled || f.readOnly} />
          </Field>
        );
      })}
    </div>
  );
}

function FieldInput({ id, field, value, error, onChange, initialRef, disabled }: { id: string; field: FieldDef; value: string; error?: string; onChange: (v: string) => void; initialRef?: RefOption; disabled?: boolean }) {
  const common = {
    id,
    disabled,
    "aria-invalid": !!error,
    "aria-describedby": error ? `${id}-error` : undefined,
    className: cx(inputClass, errorRing(error)),
  };
  const today = new Date().toISOString().slice(0, 10);

  switch (field.type) {
    case "textarea":
      return <textarea {...common} rows={3} value={value} maxLength={field.maxLength} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />;
    case "select":
      return (
        <select {...common} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">{field.required ? "Select…" : "— None —"}</option>
          {field.options?.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    case "ref":
      return <RefSelect {...common} field={field} value={value} onChange={onChange} initial={initialRef} />;
    case "date":
      return <input {...common} type="date" value={value} max={field.past ? today : undefined} onChange={(e) => onChange(e.target.value)} />;
    case "datetime":
      return <input {...common} type="datetime-local" value={value} onChange={(e) => onChange(e.target.value)} />;
    case "time":
      return <input {...common} type="time" value={value} onChange={(e) => onChange(e.target.value)} />;
    case "number":
      return <input {...common} type="number" inputMode="decimal" step="any" min={field.min} max={field.max} value={value} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />;
    default:
      return (
        <input
          {...common}
          type={field.type === "email" ? "email" : field.type === "tel" ? "tel" : "text"}
          autoComplete="off"
          value={value}
          maxLength={field.maxLength}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}

/** Searchable picker backed by /api/lookup/<module>/<resource>. */
export function RefSelect({ id, field, value, onChange, initial, disabled, className, onPick }: { id: string; field: FieldDef; value: string; onChange: (v: string) => void; initial?: RefOption; disabled?: boolean; className: string; onPick?: (o: RefOption | null) => void }) {
  const target = useMemo(() => resolveRef(field.ref!), [field.ref]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<RefOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [picked, setSelected] = useState<RefOption | undefined>(initial);
  const selected = value && picked?.id === value ? picked : undefined;
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !target) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      setFailed(null);
      try {
        const { data } = await api<RefOption[]>(`/api/lookup/${target.module.key}/${target.resource.key}?q=${encodeURIComponent(query)}`, { signal: ctrl.signal });
        setOptions(data);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setFailed((e as Error).message);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [open, query, target]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => wrap.current && !wrap.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const display = selected ? `${selected.label}${selected.code && selected.code !== selected.label ? ` (${selected.code})` : ""}` : "";

  return (
    <div ref={wrap} className="relative">
      <button id={id} type="button" disabled={disabled} onClick={() => setOpen((o) => !o)} className={cx(className, "flex items-center justify-between text-left")} aria-haspopup="listbox" aria-expanded={open}>
        <span className={cx("truncate", !display && "text-slate-400")}>{display || `Select ${field.label.toLowerCase()}…`}</span>
        <span className="ml-2 flex items-center gap-1">
          {value && !disabled && !field.required && (
            <X
              className="size-4 text-slate-400 hover:text-slate-600"
              aria-label="Clear"
              onClick={(e) => {
                e.stopPropagation();
                onChange("");
                setSelected(undefined);
                onPick?.(null);
              }}
            />
          )}
          <ChevronDown className="size-4 text-slate-400" />
        </span>
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg bg-white shadow-lg ring-1 ring-slate-200">
          <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
            <Search className="size-4 text-slate-400" aria-hidden />
            <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${target?.resource.label.toLowerCase() ?? ""}…`} className="w-full border-0 p-0 text-sm focus:ring-0 focus:outline-none" />
            {loading && <LoaderCircle className="size-4 animate-spin text-slate-400" />}
          </div>
          <ul role="listbox" className="max-h-60 overflow-y-auto py-1 text-sm">
            {failed && <li className="px-3 py-2 text-red-600">{failed}</li>}
            {!failed && !loading && options.length === 0 && <li className="px-3 py-2 text-slate-500">No matches. Records must be created in {target?.module.label} first.</li>}
            {options.map((o) => (
              <li
                key={o.id}
                role="option"
                aria-selected={o.id === value}
                onClick={() => {
                  setSelected(o);
                  onChange(o.id);
                  onPick?.(o);
                  setOpen(false);
                }}
                className={cx("cursor-pointer px-3 py-2 hover:bg-brand-50", o.id === value && "bg-brand-50")}
              >
                <div className="font-medium text-slate-900">{o.label}</div>
                {(o.code || o.sub) && <div className="text-xs text-slate-500">{[o.code, o.sub].filter(Boolean).join(" · ")}</div>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
