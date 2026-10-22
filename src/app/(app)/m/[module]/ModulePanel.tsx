"use client";

import { useSearchParams } from "next/navigation";
import { AccountsSection } from "@/components/accounts/AccountsSection";
import { AmbulanceSection } from "@/components/ambulance/AmbulanceSection";
import { BillingSection } from "@/components/billing/BillingSection";
import { BloodStockSummary } from "@/components/BloodStockSummary";
import { HrSection } from "@/components/hr/HrSection";
import { InsuranceSection } from "@/components/insurance/InsuranceSection";
import { InventorySection } from "@/components/inventory/InventorySection";
import { LabSection } from "@/components/laboratory/LabSection";
import { MarketingSection } from "@/components/marketing/MarketingSection";
import { ModuleIcon } from "@/components/ModuleIcon";
import { ResourceManager } from "@/components/ResourceManager";
import { PageHeader, cx } from "@/components/ui";
import { MODULE_MAP, moduleSections, type ModuleKey } from "@/lib/modules";

export function ModulePanel({ moduleKey, initialTab }: { moduleKey: ModuleKey; initialTab?: string }) {
  const mod = MODULE_MAP[moduleKey];
  const sections = moduleSections(mod);
  // The tab lives in the URL so sidebar links, refresh and shared links all land on it.
  const wanted = useSearchParams().get("tab") ?? initialTab;
  const current = sections.find((s) => s.key === wanted) ?? sections[0];
  const resource = mod.resources.find((r) => r.key === current.key);
  // Modules with grouped tabs show only the current group here; the sidebar lists them all.
  const visible = sections.filter((s) => s.group === current.group);

  return (
    <>
      <PageHeader
        title={current.group ? `${mod.label} · ${current.label}` : mod.label}
        description={mod.description}
        actions={
          <span className="hidden items-center gap-2 rounded-lg bg-brand-50 px-3 py-1.5 text-xs font-medium text-brand-700 sm:inline-flex">
            <ModuleIcon name={mod.icon} className="size-4" /> {current.group ?? `${mod.label} panel`}
          </span>
        }
      />
      {mod.key === "blood_bank" && <BloodStockSummary />}
      {visible.length > 1 && (
        <div className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200" role="tablist">
          {visible.map((s) => (
            <button
              key={s.key}
              role="tab"
              aria-selected={s.key === current.key}
              onClick={() => history.replaceState(null, "", `?tab=${s.key}`)}
              className={cx(
                "-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
                s.key === current.key ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-800"
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
      {resource ? (
        <ResourceManager key={resource.key} module={mod} resource={resource} />
      ) : mod.key === "laboratory" ? (
        <LabSection section={current.key} />
      ) : mod.key === "inventory" ? (
        <InventorySection section={current.key} />
      ) : mod.key === "hr" ? (
        <HrSection section={current.key} />
      ) : mod.key === "insurance" ? (
        <InsuranceSection section={current.key} />
      ) : mod.key === "ambulance" ? (
        <AmbulanceSection section={current.key} />
      ) : mod.key === "billing" ? (
        <BillingSection section={current.key} />
      ) : mod.key === "marketing" ? (
        <MarketingSection section={current.key} />
      ) : mod.key === "accounts" ? (
        <AccountsSection section={current.key} />
      ) : null}
    </>
  );
}
