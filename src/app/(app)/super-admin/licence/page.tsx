"use client";

import { RefreshCw, UploadCloud } from "lucide-react";
import { useState } from "react";
import { Alert, Badge, Button, Card, CardHeader, ErrorState, PageHeader, Spinner, useToast } from "@/components/ui";
import { api } from "@/lib/client";
import { formatDate, formatDateTime, timeAgo } from "@/lib/format";
import type { LicenceView } from "@/lib/licence-protocol";
import { MODULE_MAP } from "@/lib/modules";
import { useApiQuery } from "@/lib/useApi";

type Data = LicenceView & { controlUrl: string | null; sync: { collection: string; mode: string; lastSyncAt: string | null; sent: number; error: string | null }[] | null };

/** Client installation: the licence from the vendor and the upload of this hospital's data. */
export default function LicencePage() {
  const toast = useToast();
  const q = useApiQuery<Data>("/api/licence");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const d = q.data ?? q.stale;

  async function check() {
    setBusy("check");
    setError(null);
    try {
      const { data } = await api<{ ok: boolean; error?: string }>("/api/licence/check", { method: "POST" });
      if (data.ok) toast("Licence checked");
      else setError(data.error ?? "Check failed");
      q.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function upload() {
    setBusy("sync");
    setError(null);
    try {
      const { data } = await api<{ skipped?: string; sent: number; errors: string[] }>("/api/licence/sync", { method: "POST" });
      if (data.skipped) setError(data.skipped);
      else if (data.errors.length) setError(data.errors.slice(0, 3).join("; "));
      else toast(`Uploaded ${data.sent} change(s)`);
      q.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (q.error && !d) return <ErrorState message={q.error} onRetry={q.reload} />;
  if (!d) return <Spinner label="Loading licence…" />;
  if (d.mode !== "client") return <><PageHeader title="Licence & Sync" /><Alert tone="amber">This server is not a client installation.</Alert></>;

  return (
    <>
      <PageHeader
        title="Licence & Sync"
        description="The licence from your vendor and the backup of this hospital's data to the vendor's central server."
        actions={<div className="flex gap-2"><Button variant="secondary" onClick={check} loading={busy === "check"}><RefreshCw className="size-4" /> Check licence</Button><Button onClick={upload} loading={busy === "sync"}><UploadCloud className="size-4" /> Upload now</Button></div>}
      />
      {error && <div className="mb-4"><Alert>{error}</Alert></div>}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={d.hospitalName ?? "Licence"} description={d.clientCode ?? undefined} />
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-5 pb-5 text-sm">
            <dt className="text-slate-500">Status</dt><dd>{d.locked ? <Badge tone="red">{d.locked.reason}</Badge> : <Badge tone="green">Active</Badge>}</dd>
            <dt className="text-slate-500">Valid until</dt><dd>{d.expiresAt ? formatDate(d.expiresAt) : "No expiry"}</dd>
            <dt className="text-slate-500">Last licence check</dt><dd>{formatDateTime(d.lastCheckAt)}</dd>
            <dt className="text-slate-500">Works offline for</dt><dd>{d.offlineDaysLeft ?? "—"} more day(s)</dd>
            <dt className="text-slate-500">Licence server</dt><dd className="break-all font-mono text-xs">{d.controlUrl ?? "—"}</dd>
            {d.lastError && <><dt className="text-slate-500">Last problem</dt><dd className="text-amber-800">{d.lastError}</dd></>}
          </dl>
          <div className="border-t border-slate-100 px-5 py-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Licensed modules</p>
            <div className="flex flex-wrap gap-1.5">{(d.modules ?? []).map((m) => <Badge key={m} tone="blue">{MODULE_MAP[m]?.label ?? m}</Badge>)}</div>
            <p className="mt-2 text-xs text-slate-500">Only these modules can be assigned to admins. Contact your vendor to add more.</p>
          </div>
        </Card>
        <Card>
          <CardHeader title="Data upload" description="Changes are uploaded every 10 minutes while online. Passwords and payment keys never leave this computer." />
          {!d.sync?.length ? (
            <p className="px-5 pb-5 text-sm text-slate-500">Nothing uploaded yet.</p>
          ) : (
            <div className="max-h-96 overflow-y-auto border-t border-slate-100">
              <table className="min-w-full text-sm">
                <tbody className="divide-y divide-slate-100">
                  {d.sync.map((s) => (
                    <tr key={s.collection}>
                      <td className="px-5 py-1.5 font-mono text-xs text-slate-700">{s.collection}</td>
                      <td className="px-5 py-1.5 text-right tabular-nums text-slate-600">{s.sent.toLocaleString("en-IN")}</td>
                      <td className="px-5 py-1.5 text-right text-xs">{s.error ? <span className="text-red-700" title={s.error}>Failed</span> : <span className="text-slate-500">{s.lastSyncAt ? timeAgo(s.lastSyncAt) : ""}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
