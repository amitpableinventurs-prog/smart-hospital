"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CouponsTab, LeadsTab, PartnersTab, SALES_TABS, SalesOverview } from "@/components/control/Sales";
import { PageHeader, cx } from "@/components/ui";

/** Control Panel: selling the software — leads and trials, partners, coupons, renewals. */
export default function SalesPage() {
  const tab = useSearchParams().get("tab") ?? "overview";
  const current = SALES_TABS.some((t) => t.key === tab) ? tab : "overview";
  return (
    <>
      <PageHeader title="Sales & Marketing" description="Hospitals enquiring or on a free trial, the partners who bring them, coupon offers, and licences coming up for renewal." />
      <nav className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200" aria-label="Sales sections">
        {SALES_TABS.map((t) => (
          <Link key={t.key} href={`/super-admin/sales?tab=${t.key}`} className={cx("inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium", current === t.key ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-800")} aria-current={current === t.key ? "page" : undefined}>
            <t.icon className="size-4" /> {t.label}
          </Link>
        ))}
      </nav>
      {current === "leads" ? <LeadsTab /> : current === "partners" ? <PartnersTab /> : current === "coupons" ? <CouponsTab /> : <SalesOverview />}
    </>
  );
}
