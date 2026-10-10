"use client";

import { BedDouble, CalendarDays, Search, Stethoscope, UserPlus, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, Pagination, Spinner, StatCard, cx, inputClass, Kbd, statusTone, useDebounced, useHotkeys } from "@/components/ui";
import { qs } from "@/lib/client";
import { useApiQuery } from "@/lib/useApi";
import { ageFrom, formatDate } from "@/lib/format";
import { PATIENT_TYPES } from "@/lib/modules";

interface PatientRow {
  id: string;
  code: string;
  fullName: string;
  gender: string;
  dateOfBirth: string;
  mobile: string;
  patientType: string;
  bloodGroup: string | null;
  createdAt: string;
}
interface Summary {
  total: number;
  opd: number;
  ipd: number;
  today: number;
}

export default function PatientsPage() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [type, setType] = useState("");
  const [page, setPage] = useState(1);
  const debounced = useDebounced(search);
  const summaryQuery = useApiQuery<Summary>("/api/patients/summary");
  const summary = summaryQuery.data;
  const list = useApiQuery<PatientRow[]>(`/api/patients${qs({ search: debounced, type, page, limit: 10 })}`);
  const { loading, error, pagination: paging } = list;
  const rows = list.data ?? [];
  const searchRef = useRef<HTMLInputElement>(null);
  useHotkeys({ F2: () => router.push("/patients/new"), F3: () => searchRef.current?.focus() });

  const stat = (n?: number) => (summaryQuery.error ? "—" : n ?? "…");
  const filtered = !!(debounced || type);

  return (
    <>
      <PageHeader
        title="Patients"
        description="Register patients and manage their records across OPD and IPD."
        actions={
          <Link href="/patients/new">
            <Button>
              <UserPlus className="size-4" /> Add patient <Kbd>F2</Kbd>
            </Button>
          </Link>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total patients" value={stat(summary?.total)} icon={<Users className="size-5" />} />
        <StatCard label="OPD patients" value={stat(summary?.opd)} icon={<Stethoscope className="size-5" />} />
        <StatCard label="IPD patients" value={stat(summary?.ipd)} icon={<BedDouble className="size-5" />} tone="slate" />
        <StatCard label="Registered today" value={stat(summary?.today)} icon={<CalendarDays className="size-5" />} tone="amber" />
      </div>

      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <input ref={searchRef} value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search by name, patient ID, mobile or email…  (F3)" className={cx(inputClass, "pl-9")} aria-label="Search patients" />
          </div>
          <select value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} className={cx(inputClass, "sm:w-44")} aria-label="Patient type">
            <option value="">All patient types</option>
            {PATIENT_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>

        {loading ? (
          <Spinner label="Loading patients…" />
        ) : error ? (
          <ErrorState message={error} onRetry={() => { list.reload(); summaryQuery.reload(); }} />
        ) : rows.length === 0 ? (
          <EmptyState
            title={filtered ? "No patients match your search" : "No patients registered yet"}
            description={filtered ? "Try a different name, ID or filter." : "Registered patients will appear here."}
            action={!filtered && <Link href="/patients/new"><Button><UserPlus className="size-4" /> Register first patient</Button></Link>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead className="bg-slate-50/60">
                <tr>
                  {["Patient ID", "Name", "Age / Gender", "Mobile", "Type", "Blood group", "Registered"].map((h) => (
                    <th key={h} className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((p) => (
                  <tr key={p.id} onClick={() => router.push(`/patients/${p.id}`)} className="cursor-pointer hover:bg-brand-50/40">
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-600">{p.code}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <Link href={`/patients/${p.id}`} className="font-medium text-slate-900 hover:text-brand-700" onClick={(e) => e.stopPropagation()}>
                        {p.fullName}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">{ageFrom(p.dateOfBirth) ?? "—"} yrs · {p.gender}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">{p.mobile}</td>
                    <td className="whitespace-nowrap px-4 py-3"><Badge tone={statusTone(p.patientType)}>{p.patientType}</Badge></td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">{p.bloodGroup ?? "—"}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-500">{formatDate(p.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!loading && !error && <Pagination pagination={paging} onPage={setPage} />}
      </Card>
    </>
  );
}
