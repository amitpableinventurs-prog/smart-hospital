"use client";

import { useId, useState, type ReactNode } from "react";
import { ApiClientError } from "@/lib/client";
import { Alert, Button, Field, cx, errorRing, inputClass, omitKey } from "./ui";

export interface ModalField {
  name: string;
  label: string;
  type?: "text" | "textarea" | "number" | "date" | "month" | "time" | "select" | "checkbox";
  options?: readonly string[];
  required?: boolean;
  hint?: string;
  placeholder?: string;
  min?: number;
  max?: number;
  maxLength?: number;
  wide?: boolean;
  defaultValue?: string | boolean;
}

export type ModalValues = Record<string, string | boolean>;

/**
 * Small workflow dialog (approve, settle, cancel…): renders the fields, sends
 * the values to `onSubmit` and shows the API's field errors next to the inputs.
 */
export function FormModal({
  title,
  description,
  fields,
  confirmLabel = "Save",
  danger,
  onSubmit,
  onClose,
  children,
  size = "md",
}: {
  title: string;
  description?: string;
  fields: ModalField[];
  confirmLabel?: string;
  danger?: boolean;
  onSubmit: (values: ModalValues) => Promise<unknown>;
  onClose: () => void;
  /** Extra content above the fields (e.g. a summary), given the current values. */
  children?: (values: ModalValues) => ReactNode;
  size?: "md" | "lg";
}) {
  const formId = useId();
  const [values, setValues] = useState<ModalValues>(() => Object.fromEntries(fields.map((f) => [f.name, f.defaultValue ?? (f.type === "checkbox" ? false : "")])));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    const missing = Object.fromEntries(fields.filter((f) => f.required && f.type !== "checkbox" && !String(values[f.name] ?? "").trim()).map((f) => [f.name, `${f.label} is required`]));
    setErrors(missing);
    if (Object.keys(missing).length) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(values);
    } catch (err) {
      if (err instanceof ApiClientError && err.fields) setErrors(err.fields);
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const set = (name: string, v: string | boolean) => {
    setValues((s) => ({ ...s, [name]: v }));
    if (errors[name]) setErrors((x) => omitKey(x, name));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[1px]" onClick={onClose} aria-hidden />
      <form
        onSubmit={submit}
        noValidate
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
        className={cx("relative flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl", size === "lg" ? "max-w-2xl" : "max-w-md")}
      >
        <div className="border-b border-slate-100 px-6 py-4">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
        </div>
        <div className="space-y-4 overflow-y-auto px-6 py-5">
          {error && <Alert>{error}</Alert>}
          {children?.(values)}
          <div className={cx("grid gap-4", size === "lg" && "sm:grid-cols-2")}>
            {fields.map((f, i) => {
              const id = `${formId}-${f.name}`;
              const common = { id, disabled: busy, "aria-invalid": !!errors[f.name], className: cx(inputClass, errorRing(errors[f.name])), autoFocus: i === 0 };
              if (f.type === "checkbox") {
                return (
                  <label key={f.name} className={cx("flex items-start gap-2 text-sm text-slate-700", (f.wide || size === "md") && "sm:col-span-2")}>
                    <input type="checkbox" checked={values[f.name] === true} disabled={busy} onChange={(e) => set(f.name, e.target.checked)} className="mt-0.5 size-4 rounded border-slate-300 text-brand-600" />
                    <span>
                      {f.label}
                      {f.hint && <span className="block text-xs text-slate-500">{f.hint}</span>}
                      {errors[f.name] && <span className="block text-xs text-red-600">{errors[f.name]}</span>}
                    </span>
                  </label>
                );
              }
              const v = String(values[f.name] ?? "");
              return (
                <Field key={f.name} label={f.label} htmlFor={id} required={f.required} error={errors[f.name]} hint={f.hint} className={f.wide ? "sm:col-span-2" : undefined}>
                  {f.type === "textarea" ? (
                    <textarea {...common} rows={3} value={v} maxLength={f.maxLength ?? 1000} placeholder={f.placeholder} onChange={(e) => set(f.name, e.target.value)} />
                  ) : f.type === "select" ? (
                    <select {...common} value={v} onChange={(e) => set(f.name, e.target.value)}>
                      <option value="">Select…</option>
                      {f.options?.map((o) => <option key={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input
                      {...common}
                      type={f.type ?? "text"}
                      inputMode={f.type === "number" ? "decimal" : undefined}
                      step={f.type === "number" ? "any" : undefined}
                      min={f.min}
                      max={f.max}
                      maxLength={f.maxLength}
                      value={v}
                      placeholder={f.placeholder}
                      onChange={(e) => set(f.name, e.target.value)}
                    />
                  )}
                </Field>
              );
            })}
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-4">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>Back</Button>
          <Button type="submit" variant={danger ? "danger" : "primary"} loading={busy}>{confirmLabel}</Button>
        </div>
      </form>
    </div>
  );
}

/** Number from a modal value ("" → undefined). */
export function numOrUndefined(v: string | boolean | undefined) {
  return typeof v === "string" && v.trim() !== "" ? Number(v) : undefined;
}
