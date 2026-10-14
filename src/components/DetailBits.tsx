"use client";

import { formatDateTime } from "@/lib/format";
import { Card, CardHeader, cx } from "./ui";

/** Building blocks for workflow detail pages (pre-auths, claims, trips). */

export interface TimelineEvent {
  at: string;
  action: string;
  byName?: string;
  note?: string;
}

export function Figure({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "green" | "red" | "amber" }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={cx("mt-1 text-xl font-semibold tabular-nums", tone === "green" ? "text-emerald-700" : tone === "red" ? "text-red-600" : tone === "amber" ? "text-amber-700" : "text-slate-900")}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </Card>
  );
}

export function Info({ label, value, wide }: { label: string; value?: string | number | null; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 whitespace-pre-line text-sm text-slate-900">{value === undefined || value === null || value === "" ? "—" : value}</dd>
    </div>
  );
}

export function Timeline({ events }: { events: TimelineEvent[] }) {
  return (
    <Card>
      <CardHeader title="Timeline" />
      <ol className="space-y-3 p-5">
        {[...events].reverse().map((e, i) => (
          <li key={i} className="relative border-l-2 border-slate-200 pl-3 text-sm">
            <p className="font-medium text-slate-900">{e.action}</p>
            {e.note && <p className="text-slate-600">{e.note}</p>}
            <p className="text-xs text-slate-500">{formatDateTime(e.at)}{e.byName ? ` · ${e.byName}` : ""}</p>
          </li>
        ))}
      </ol>
    </Card>
  );
}
