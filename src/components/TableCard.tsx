"use client";

import type { ReactNode } from "react";
import { Card, CardHeader, cx } from "./ui";

/** Compact report table: first column left-aligned, figures right-aligned. */
export function TableCard({ title, description, headers, rows, empty, actions }: { title: string; description?: string; headers: string[]; rows: ReactNode[][]; empty: string; actions?: ReactNode }) {
  return (
    <Card className="break-inside-avoid">
      <CardHeader title={title} description={description} actions={actions} />
      {rows.length === 0 ? (
        <p className="px-5 py-4 text-sm text-slate-500">{empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead><tr>{headers.map((h, i) => <th key={h} className={cx("whitespace-nowrap px-5 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500", i === 0 ? "text-left" : "text-right")}>{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r, i) => (
                <tr key={i}>{r.map((c, j) => <td key={j} className={cx("whitespace-nowrap px-5 py-2 tabular-nums", j === 0 ? "text-left text-slate-800" : "text-right text-slate-700")}>{c}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
