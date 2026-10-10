"use client";

import Link from "next/link";
import { useState } from "react";
import { qs } from "@/lib/client";
import { useApiQuery } from "@/lib/useApi";
import { ACTION_LABELS, formatDateTime } from "@/lib/format";
import { MODULES } from "@/lib/modules";
import { actionTone, moduleName } from "./ActivityFeed";
import { Badge, Card, EmptyState, ErrorState, Pagination, Spinner, cx, inputClass, useDebounced } from "./ui";

interface LogRow {
  id: string;
  createdAt: string | null;
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  actorRole: string | null;
  action: string;
  module: string;
  entityLabel: string | null;
  summary: string;
  ip: string | null;
}

export interface AdminOption {
  id: string;
  name: string;
}

/** Filterable, paginated audit trail. Pass `actor` to lock it to one admin. */
export function ActivityLogView({ actor, admins }: { actor?: string; admins?: AdminOption[] }) {
  const [search, setSearch] = useState("");
  const [actorFilter, setActorFilter] = useState("");
  const [module, setModule] = useState("");
  const [action, setAction] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const debounced = useDebounced(search);
  /** Wrap a filter setter so changing it returns to page 1. */
  const f = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(1);
  };
  const actorId = actor ?? actorFilter;
  const list = useApiQuery<LogRow[]>(`/api/activity${qs({ search: debounced, actor: actorId, module, action, from, to, page, limit: 25 })}`);
  const { loading, error, pagination: paging } = list;
  const rows = list.data ?? [];

  const filtered = !!(debounced || actorFilter || module || action || from || to);

  return (
    <Card>
      <div className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-2 lg:grid-cols-6">
        <input value={search} onChange={(e) => f(setSearch)(e.target.value)} placeholder="Search summary, record or user…" className={cx(inputClass, "lg:col-span-2")} aria-label="Search activity" />
        {!actor && admins && (
          <select value={actorFilter} onChange={(e) => f(setActorFilter)(e.target.value)} className={inputClass} aria-label="Filter by admin">
            <option value="">All users</option>
            {admins.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        )}
        <select value={module} onChange={(e) => f(setModule)(e.target.value)} className={inputClass} aria-label="Filter by module">
          <option value="">All modules</option>
          <option value="system">System (sign-ins, admins)</option>
          {MODULES.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
        </select>
        <select value={action} onChange={(e) => f(setAction)(e.target.value)} className={inputClass} aria-label="Filter by action">
          <option value="">All actions</option>
          {Object.entries(ACTION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <div className={cx("flex gap-2", actor ? "lg:col-span-2" : "")}>
          <input type="date" value={from} max={to || undefined} onChange={(e) => f(setFrom)(e.target.value)} className={inputClass} aria-label="From date" />
          <input type="date" value={to} min={from || undefined} onChange={(e) => f(setTo)(e.target.value)} className={inputClass} aria-label="To date" />
        </div>
      </div>

      {loading ? (
        <Spinner label="Loading activity…" />
      ) : error ? (
        <ErrorState message={error} onRetry={list.reload} />
      ) : rows.length === 0 ? (
        <EmptyState title={filtered ? "No activity matches these filters" : "No activity recorded yet"} />
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead className="bg-slate-50/60">
              <tr>
                {["When", ...(actor ? [] : ["User"]), "Action", "Module", "Details", "IP"].map((h) => (
                  <th key={h} className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">{formatDateTime(r.createdAt)}</td>
                  {!actor && (
                    <td className="whitespace-nowrap px-4 py-3">
                      {r.actorId && r.actorRole === "admin" ? (
                        <Link href={`/super-admin/admins/${r.actorId}`} className="font-medium text-slate-900 hover:text-brand-700">{r.actorName}</Link>
                      ) : (
                        <span className="font-medium text-slate-900">{r.actorName ?? "Unknown"}</span>
                      )}
                      <p className="text-xs text-slate-500">{r.actorRole === "super_admin" ? "Super admin" : r.actorEmail}</p>
                    </td>
                  )}
                  <td className="whitespace-nowrap px-4 py-3"><Badge tone={actionTone(r.action)}>{ACTION_LABELS[r.action] ?? r.action}</Badge></td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">{moduleName(r.module)}</td>
                  <td className="min-w-[18rem] px-4 py-3 text-slate-700">{r.summary}</td>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-500">{r.ip ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!loading && !error && <Pagination pagination={paging} onPage={setPage} />}
    </Card>
  );
}
