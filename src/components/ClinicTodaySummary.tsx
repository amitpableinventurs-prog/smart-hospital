"use client";

import { RefreshCw } from "lucide-react";
import { formatMoney } from "@/lib/format";
import { useApiQuery } from "@/lib/useApi";
import { Card, CardHeader, cx } from "./ui";

interface Today {
  clinics: {
    id: string;
    name: string;
    doctor: string | null;
    roomNo: string | null;
    hours: string;
    serving: number | null;
    next: number | null;
    waiting: number;
    completed: number;
    missed: number;
    collected: number;
  }[];
}

/** Today's queue position and fee collection for each active clinic. */
export function ClinicTodaySummary() {
  const q = useApiQuery<Today>("/api/clinic/today");
  const data = q.data ?? q.stale;
  const total = data?.clinics.reduce((s, c) => s + c.collected, 0) ?? 0;

  return (
    <Card className="mb-6">
      <CardHeader
        title="Today at the clinic"
        description="Token now with the doctor, next in line, and fees received today"
        actions={
          <button onClick={q.reload} className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">
            <RefreshCw className={cx("size-3.5", q.loading && "animate-spin")} /> Refresh
          </button>
        }
      />
      {!data ? (
        <p className="px-5 py-6 text-sm text-slate-500">{q.error ?? "Loading…"}</p>
      ) : data.clinics.length === 0 ? (
        <p className="px-5 py-6 text-sm text-slate-500">No active clinics yet. Add one under Setup → Clinics.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-500">
                <th className="px-5 py-2 text-left font-semibold">Clinic</th>
                <th className="px-3 py-2 text-right font-semibold">Now serving</th>
                <th className="px-3 py-2 text-right font-semibold">Next</th>
                <th className="px-3 py-2 text-right font-semibold">Waiting</th>
                <th className="px-3 py-2 text-right font-semibold">Seen</th>
                <th className="px-3 py-2 text-right font-semibold">Missed</th>
                <th className="px-5 py-2 text-right font-semibold">Collected</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 tabular-nums">
              {data.clinics.map((c) => (
                <tr key={c.id}>
                  <td className="px-5 py-2">
                    <p className="font-semibold text-slate-900">{c.name}</p>
                    <p className="text-xs text-slate-500">{[c.doctor, c.roomNo && `Room ${c.roomNo}`, c.hours].filter(Boolean).join(" · ")}</p>
                  </td>
                  <td className="px-3 py-2 text-right text-lg font-semibold text-brand-700">{c.serving ?? "—"}</td>
                  <td className="px-3 py-2 text-right font-medium text-slate-800">{c.next ?? "—"}</td>
                  <td className={cx("px-3 py-2 text-right", c.waiting ? "font-semibold text-amber-700" : "text-slate-300")}>{c.waiting}</td>
                  <td className={cx("px-3 py-2 text-right", c.completed ? "text-slate-800" : "text-slate-300")}>{c.completed}</td>
                  <td className={cx("px-3 py-2 text-right", c.missed ? "text-slate-600" : "text-slate-300")}>{c.missed}</td>
                  <td className="px-5 py-2 text-right text-slate-800">{formatMoney(c.collected)}</td>
                </tr>
              ))}
            </tbody>
            {data.clinics.length > 1 && (
              <tfoot>
                <tr className="border-t border-slate-200 font-semibold text-slate-900">
                  <td colSpan={6} className="px-5 py-2 text-right">Total collected today</td>
                  <td className="px-5 py-2 text-right tabular-nums">{formatMoney(total)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </Card>
  );
}
