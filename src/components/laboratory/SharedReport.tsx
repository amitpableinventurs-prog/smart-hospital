"use client";

import { PrintFrame } from "./PrintViews";
import { ReportDocument } from "./ReportDocument";

export function SharedReport({ token }: { token: string }) {
  return (
    <main className="min-h-screen bg-slate-100 px-4 py-6 print:bg-white print:p-0">
      <PrintFrame url={`/api/public/lab-report/${encodeURIComponent(token)}`} kind="report">{(o) => <ReportDocument order={o} />}</PrintFrame>
    </main>
  );
}
