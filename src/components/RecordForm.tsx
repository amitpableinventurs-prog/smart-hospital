"use client";

import { Camera, ChevronDown, LoaderCircle, Search, Trash2, UserRound, X } from "lucide-react";
import { Fragment, useEffect, useId, useMemo, useRef, useState } from "react";
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
  const out: Record<string, RefOption | RefOption[]> = {};
  if (!record) return out;
  for (const f of resource.fields) {
    const v = record[f.name] as RefOption | RefOption[] | null;
    if ((f.type === "ref" || f.type === "multiref") && v && typeof v === "object") out[f.name] = v;
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
  refLabels?: Record<string, RefOption | RefOption[]>;
  disabled?: boolean;
}) {
  const formId = useId();
  return (
    <div className="grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2">
      {resource.fields.map((f, i) => {
        const id = `${formId}-${f.name}`;
        return (
          <Fragment key={f.name}>
            {f.section && (
              <h3 className={cx("text-xs font-semibold uppercase tracking-wider text-brand-700 sm:col-span-2", i > 0 && "mt-2 border-t border-slate-100 pt-4")}>{f.section}</h3>
            )}
            <Field label={f.label} htmlFor={id} required={f.required && !f.readOnly} error={errors[f.name]} hint={f.hint} className={f.wide ? "sm:col-span-2" : undefined}>
              <FieldInput id={id} field={f} value={values[f.name] ?? ""} error={errors[f.name]} onChange={(v) => onChange(f.name, v)} initialRef={refLabels?.[f.name]} disabled={disabled || f.readOnly} />
            </Field>
          </Fragment>
        );
      })}
    </div>
  );
}

function FieldInput({ id, field, value, error, onChange, initialRef, disabled }: { id: string; field: FieldDef; value: string; error?: string; onChange: (v: string) => void; initialRef?: RefOption | RefOption[]; disabled?: boolean }) {
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
      return <RefSelect {...common} field={field} value={value} onChange={onChange} initial={Array.isArray(initialRef) ? undefined : initialRef} />;
    case "multiref":
      return <MultiRefSelect {...common} field={field} value={value} onChange={onChange} initial={Array.isArray(initialRef) ? initialRef : []} />;
    case "multiselect":
      return <MultiSelect id={id} field={field} value={value} onChange={onChange} disabled={disabled} error={error} />;
    case "image":
      return <PhotoInput id={id} value={value} onChange={onChange} disabled={disabled} />;
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

/** Several references: removable chips plus a picker that adds one at a time. */
function MultiRefSelect({ id, field, value, onChange, initial, disabled, className }: { id: string; field: FieldDef; value: string; onChange: (v: string) => void; initial: RefOption[]; disabled?: boolean; className: string }) {
  const [known, setKnown] = useState<RefOption[]>(initial);
  const ids = value ? value.split(",") : [];
  const label = (rid: string) => known.find((k) => k.id === rid);
  return (
    <div className="space-y-2">
      {ids.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {ids.map((rid) => {
            const o = label(rid);
            return (
              <li key={rid} className="inline-flex items-center gap-1 rounded-full bg-brand-50 py-1 pl-2.5 pr-1 text-xs font-medium text-brand-800 ring-1 ring-inset ring-brand-200">
                {o ? o.label : rid.slice(-6)}
                {o?.code && <span className="text-brand-600/70">{o.code}</span>}
                {!disabled && (
                  <button type="button" onClick={() => onChange(ids.filter((x) => x !== rid).join(","))} className="rounded-full p-0.5 hover:bg-brand-100" aria-label={`Remove ${o?.label ?? "item"}`}>
                    <X className="size-3" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <RefSelect
        id={id}
        field={{ ...field, required: true, label: field.label.replace(/s$/, "") }}
        value=""
        disabled={disabled}
        className={className}
        onChange={() => {}}
        onPick={(o) => {
          if (!o || ids.includes(o.id)) return;
          setKnown((k) => [...k, o]);
          onChange([...ids, o.id].join(","));
        }}
      />
    </div>
  );
}

/** Toggle chips for picking several options (e.g. working days). */
function MultiSelect({ id, field, value, onChange, disabled, error }: { id: string; field: FieldDef; value: string; onChange: (v: string) => void; disabled?: boolean; error?: string }) {
  const selected = value ? value.split(",") : [];
  const toggle = (o: string) => onChange((field.options ?? []).filter((x) => (x === o ? !selected.includes(o) : selected.includes(x))).join(","));
  return (
    <div id={id} role="group" aria-describedby={error ? `${id}-error` : undefined} className="flex flex-wrap gap-2">
      {field.options?.map((o) => {
        const on = selected.includes(o);
        return (
          <button
            key={o}
            type="button"
            disabled={disabled}
            aria-pressed={on}
            onClick={() => toggle(o)}
            className={cx(
              "min-w-12 rounded-full px-3 py-1.5 text-sm font-medium ring-1 ring-inset transition-colors disabled:opacity-60",
              on ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50",
              error && !on && "ring-red-300"
            )}
          >
            {o}
          </button>
        );
      })}
    </div>
  );
}

/** Downscale a picked image so it can be stored with the record. */
async function resizeImage(file: File, maxSide: number): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.85);
}

function PhotoInput({ id, value, onChange, disabled }: { id: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function pick(file: File | undefined) {
    if (!file) return;
    setProblem(null);
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return setProblem("Choose a JPEG, PNG or WebP image.");
    if (file.size > 10 * 1024 * 1024) return setProblem("Image must be smaller than 10 MB.");
    setBusy(true);
    try {
      onChange(await resizeImage(file, 320));
    } catch {
      setProblem("This image could not be read.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="flex items-center gap-4">
      <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-100 ring-1 ring-slate-200">
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element -- data URL preview
          <img src={value} alt="Doctor photo" className="size-full object-cover" />
        ) : (
          <UserRound className="size-9 text-slate-400" aria-hidden />
        )}
      </div>
      <div className="space-y-1.5">
        <div className="flex flex-wrap gap-2">
          <button id={id} type="button" disabled={disabled || busy} onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 disabled:opacity-60">
            {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Camera className="size-4" />} {value ? "Change photo" : "Upload photo"}
          </button>
          {value && (
            <button type="button" disabled={disabled || busy} onClick={() => onChange("")} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-60">
              <Trash2 className="size-4" /> Remove
            </button>
          )}
        </div>
        {problem && <p className="text-xs text-red-600">{problem}</p>}
      </div>
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" tabIndex={-1} onChange={(e) => pick(e.target.files?.[0])} />
    </div>
  );
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
        const narrow = Object.entries(field.refFilter ?? {}).map(([k, v]) => `&f.${k}=${encodeURIComponent(v)}`).join("");
        const { data } = await api<RefOption[]>(`/api/lookup/${target.module.key}/${target.resource.key}?q=${encodeURIComponent(query)}${narrow}`, { signal: ctrl.signal });
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
  }, [open, query, target, field.refFilter]);

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
