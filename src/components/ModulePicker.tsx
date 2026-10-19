"use client";

import { MODULES, type ModuleKey } from "@/lib/modules";
import { useApiQuery } from "@/lib/useApi";
import { ModuleIcon } from "./ModuleIcon";
import { cx } from "./ui";

/** Checkbox grid for allocating modules to an admin. */
export function ModulePicker({ value, onChange, error, disabled, label = "Allocated modules" }: { value: ModuleKey[]; onChange: (v: ModuleKey[]) => void; error?: string; disabled?: boolean; label?: string }) {
  // The super admin's modules are the ones that exist here (on a client installation, the licensed ones).
  const me = useApiQuery<{ modules: ModuleKey[] }>("/api/auth/me");
  const options = MODULES.filter((m) => !me.data || me.data.modules.includes(m.key));
  const toggle = (k: ModuleKey) => onChange(value.includes(k) ? value.filter((x) => x !== k) : [...value, k]);
  const all = options.every((m) => value.includes(m.key));
  return (
    <fieldset disabled={disabled}>
      <div className="mb-2 flex items-center justify-between">
        <legend className="text-sm font-medium text-slate-700">
          {label}<span className="ml-0.5 text-red-600">*</span>
        </legend>
        <button type="button" onClick={() => onChange(all ? [] : options.map((m) => m.key))} className="text-xs font-medium text-brand-700 hover:underline">
          {all ? "Clear all" : "Select all"}
        </button>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {options.map((m) => {
          const on = value.includes(m.key);
          return (
            <label key={m.key} className={cx("flex cursor-pointer items-start gap-3 rounded-lg p-3 ring-1 ring-inset transition-colors", on ? "bg-brand-50 ring-brand-300" : "ring-slate-200 hover:bg-slate-50")}>
              <input type="checkbox" checked={on} onChange={() => toggle(m.key)} className="mt-0.5 size-4 rounded border-slate-300 accent-brand-600" />
              <ModuleIcon name={m.icon} className={cx("mt-0.5 size-4 shrink-0", on ? "text-brand-700" : "text-slate-400")} />
              <span>
                <span className="block text-sm font-medium text-slate-900">{m.label}</span>
                <span className="block text-xs text-slate-500">{m.description}</span>
              </span>
            </label>
          );
        })}
      </div>
      {error && <p className="mt-1.5 text-xs text-red-600">{error}</p>}
    </fieldset>
  );
}
