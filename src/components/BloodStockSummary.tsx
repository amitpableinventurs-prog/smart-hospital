"use client";

import { RefreshCw, TriangleAlert } from "lucide-react";
import { useApiQuery } from "@/lib/useApi";
import { Card, CardHeader, cx } from "./ui";

interface Stock {
  components: string[];
  groups: { group: string; byComponent: number[]; total: number; demand: number }[];
  expiringIn7Days: number;
  pendingScreening: number;
}

const SHORT: Record<string, string> = {
  "Whole Blood": "WB",
  "Packed RBC": "PRBC",
  Platelets: "PLT",
  "Fresh Frozen Plasma": "FFP",
  Cryoprecipitate: "CRYO",
};

/** Available, screened bags per blood group and component, with pending demand. */
export function BloodStockSummary() {
  const q = useApiQuery<Stock>("/api/blood-bank/stock");
  const data = q.data ?? q.stale;

  return (
    <Card className="mb-6">
      <CardHeader
        title="Blood stock position"
        description="Screened, unexpired bags available for issue · demand = units in pending requests"
        actions={
          <button onClick={q.reload} className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">
            <RefreshCw className={cx("size-3.5", q.loading && "animate-spin")} /> Refresh
          </button>
        }
      />
      {!data ? (
        <p className="px-5 py-6 text-sm text-slate-500">{q.error ?? "Loading stock…"}</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-2 text-left font-semibold">Group</th>
                  {data.components.map((c) => (
                    <th key={c} className="px-3 py-2 text-right font-semibold" title={c}>{SHORT[c] ?? c}</th>
                  ))}
                  <th className="px-3 py-2 text-right font-semibold">Total</th>
                  <th className="px-5 py-2 text-right font-semibold">Demand</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 tabular-nums">
                {data.groups.map((g) => (
                  <tr key={g.group}>
                    <td className="px-5 py-2 font-semibold text-slate-900">{g.group}</td>
                    {g.byComponent.map((n, i) => (
                      <td key={i} className={cx("px-3 py-2 text-right", n === 0 ? "text-slate-300" : "text-slate-800")}>{n}</td>
                    ))}
                    <td className="px-3 py-2 text-right font-semibold text-slate-900">{g.total}</td>
                    <td className={cx("px-5 py-2 text-right", g.demand > g.total ? "font-semibold text-red-700" : "text-slate-600")}>
                      {g.demand > 0 ? g.demand : "—"}
                      {g.demand > g.total && <span className="ml-1 text-xs font-normal">(short {g.demand - g.total})</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(data.expiringIn7Days > 0 || data.pendingScreening > 0) && (
            <div className="flex flex-wrap gap-4 border-t border-slate-100 px-5 py-3 text-xs text-amber-800">
              {data.expiringIn7Days > 0 && (
                <span className="inline-flex items-center gap-1"><TriangleAlert className="size-3.5" /> {data.expiringIn7Days} bag(s) expire within 7 days</span>
              )}
              {data.pendingScreening > 0 && (
                <span className="inline-flex items-center gap-1"><TriangleAlert className="size-3.5" /> {data.pendingScreening} bag(s) awaiting screening — not issuable yet</span>
              )}
            </div>
          )}
        </>
      )}
    </Card>
  );
}
