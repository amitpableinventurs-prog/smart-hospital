"use client";

import { useState } from "react";
import { BloodStockSummary } from "@/components/BloodStockSummary";
import { ModuleIcon } from "@/components/ModuleIcon";
import { ResourceManager } from "@/components/ResourceManager";
import { PageHeader, cx } from "@/components/ui";
import { MODULE_MAP, type ModuleKey } from "@/lib/modules";

export function ModulePanel({ moduleKey, initialTab }: { moduleKey: ModuleKey; initialTab?: string }) {
  const mod = MODULE_MAP[moduleKey];
  const [tab, setTab] = useState(initialTab ?? mod.resources[0].key);
  const resource = mod.resources.find((r) => r.key === tab) ?? mod.resources[0];

  return (
    <>
      <PageHeader
        title={mod.label}
        description={mod.description}
        actions={
          <span className="hidden items-center gap-2 rounded-lg bg-brand-50 px-3 py-1.5 text-xs font-medium text-brand-700 sm:inline-flex">
            <ModuleIcon name={mod.icon} className="size-4" /> {mod.label} panel
          </span>
        }
      />
      {mod.key === "blood_bank" && <BloodStockSummary />}
      {mod.resources.length > 1 && (
        <div className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200" role="tablist">
          {mod.resources.map((r) => (
            <button
              key={r.key}
              role="tab"
              aria-selected={r.key === resource.key}
              onClick={() => {
                setTab(r.key);
                // Keep the tab in the URL so refresh and shared links land on it.
                history.replaceState(null, "", `?tab=${r.key}`);
              }}
              className={cx(
                "-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
                r.key === resource.key ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-800"
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      )}
      <ResourceManager key={resource.key} module={mod} resource={resource} />
    </>
  );
}
