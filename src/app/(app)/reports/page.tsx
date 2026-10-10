import { ReportsView } from "@/components/ReportsView";
import { REPORT_TABS, type ReportKey } from "@/lib/report-tabs";

// Session-checked, per-user data: allowed to block (see (app)/layout.tsx).
export const instant = false;

export default async function ReportsPage({ searchParams }: PageProps<"/reports">) {
  const { tab } = await searchParams;
  const initial = REPORT_TABS.find((t) => t.key === tab)?.key ?? "daybook";
  return <ReportsView initialTab={initial as ReportKey} />;
}
