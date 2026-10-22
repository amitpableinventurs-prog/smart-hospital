"use client";

import { ArrowLeft, Ban, CheckCircle2, Database, Gift, Globe, Hospital, IndianRupee, KeyRound, Palette, Pencil, RefreshCw, RotateCcw, Server, XCircle } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { BrandingForm } from "@/components/control/BrandingForm";
import { ClientForm, LicenceKeyModal, isExpired, isOnline, type ClientRow } from "@/components/control/ClientForm";
import { PaymentsTable, RecordPaymentModal } from "@/components/control/Payments";
import { Alert, Badge, Button, Card, CardHeader, ConfirmDialog, ErrorState, PageHeader, Spinner, useToast } from "@/components/ui";
import { api } from "@/lib/client";
import type { PaymentRow } from "@/lib/control-shared";
import { formatDate, formatDateTime, timeAgo } from "@/lib/format";
import { MODULE_MAP } from "@/lib/modules";
import { useApiQuery } from "@/lib/useApi";

type Confirm = "suspend" | "activate" | "reset-installation" | "regenerate-key" | null;

export default function ClientPage() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const q = useApiQuery<ClientRow>(`/api/control/clients/${id}`);
  const data = useApiQuery<{ dbName: string; lastSyncAt: string | null; collections: { name: string; docs: number }[] }>(`/api/control/clients/${id}/data`);
  const payments = useApiQuery<{ rows: PaymentRow[] }>(`/api/control/payments?client=${id}&limit=10`);
  const [editing, setEditing] = useState(false);
  const [branding, setBranding] = useState(false);
  const [paying, setPaying] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [issuedKey, setIssuedKey] = useState<string | null>(null);
  const c = q.data ?? q.stale;

  async function run(action: string, success: string) {
    setBusy(action);
    setError(null);
    try {
      const { data: res } = await api<{ client: ClientRow; licenceKey?: string }>(`/api/control/clients/${id}/action`, { method: "POST", body: { action } });
      if (res.licenceKey) setIssuedKey(res.licenceKey);
      toast(success);
      q.reload();
      setConfirm(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function setStatus(status: "Active" | "Suspended") {
    setBusy("status");
    setError(null);
    try {
      await api(`/api/control/clients/${id}`, { method: "PATCH", body: { status } });
      toast(status === "Suspended" ? "Client suspended — their app locks at its next check-in" : "Client re-activated");
      q.reload();
      setConfirm(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (q.error && !c) return <ErrorState message={q.error} onRetry={q.reload} />;
  if (!c) return <Spinner label="Loading client…" />;
  const online = isOnline(c);
  const stats = c.lastStats ?? {};

  return (
    <>
      <Link href="/super-admin/clients" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="size-4" /> Clients</Link>
      <PageHeader
        title={c.name}
        description={`${c.code}${c.city ? ` · ${c.city}` : ""}${c.contactName ? ` · ${c.contactName}` : ""}${c.contactPhone ? ` ${c.contactPhone}` : ""}`}
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setEditing(true)}><Pencil className="size-4" /> Edit</Button>
            {c.status === "Active" ? <Button variant="danger" onClick={() => setConfirm("suspend")}><Ban className="size-4" /> Suspend</Button> : <Button onClick={() => setConfirm("activate")}><CheckCircle2 className="size-4" /> Re-activate</Button>}
          </div>
        }
      />
      {error && <div className="mb-4"><Alert>{error}</Alert></div>}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Licence" />
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-5 pb-5 text-sm">
            <dt className="text-slate-500">Status</dt>
            <dd>{c.status === "Suspended" ? <Badge tone="red">Suspended</Badge> : isExpired(c) ? <Badge tone="red">Expired</Badge> : <Badge tone="green">Active</Badge>}</dd>
            <dt className="text-slate-500">Plan</dt>
            <dd>{c.plan ? <span className="font-medium text-slate-900">{c.plan.name}</span> : <span className="text-slate-500">Custom</span>} {c.trial && <Badge tone="violet"><Gift className="size-3" /> Free trial</Badge>}</dd>
            <dt className="text-slate-500">Valid until</dt><dd>{c.expiresAt ? formatDate(c.expiresAt) : "No expiry"}</dd>
            <dt className="text-slate-500">Staff logins</dt><dd>{c.maxUsers || "Unlimited"}{typeof stats.users === "number" ? <span className="text-slate-500"> · {stats.users} in use</span> : null}</dd>
            <dt className="text-slate-500">Offline grace</dt><dd>{c.graceDays} days</dd>
            <dt className="text-slate-500">Licence key</dt>
            <dd className="flex items-center gap-2"><span className="font-mono">•••••-{c.keyLast4}</span><Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setConfirm("regenerate-key")}><KeyRound className="size-3.5" /> New key</Button></dd>
            {c.notice && <><dt className="text-slate-500">Notice</dt><dd className="text-slate-700">{c.notice}</dd></>}
          </dl>
          <div className="border-t border-slate-100 px-5 py-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Licensed modules ({c.modules.length})</p>
            <div className="flex flex-wrap gap-1.5">{c.modules.map((m) => <Badge key={m} tone="blue">{MODULE_MAP[m]?.label ?? m}</Badge>)}</div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Installation" actions={online ? <Badge tone="green">Online</Badge> : <Badge tone="slate">{c.lastSeenAt ? `Seen ${timeAgo(c.lastSeenAt)}` : "Never connected"}</Badge>} />
          {c.installed ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-5 pb-5 text-sm">
              <dt className="text-slate-500">Computer</dt><dd className="font-medium text-slate-900">{c.lastHost ?? c.activationHost ?? "—"}</dd>
              <dt className="text-slate-500">Activated</dt><dd>{formatDateTime(c.activatedAt)}</dd>
              <dt className="text-slate-500">Last check-in</dt><dd>{formatDateTime(c.lastSeenAt)}{c.lastIp && c.lastIp !== "local" ? <span className="block font-mono text-xs text-slate-500">from {c.lastIp}</span> : null}</dd>
              <dt className="text-slate-500">Version</dt><dd>{c.lastVersion ? `v${c.lastVersion}` : "—"}</dd>
              <dt className="text-slate-500">Usage</dt>
              <dd className="text-slate-700">{[stats.users != null && `${stats.users} users`, stats.patients != null && `${stats.patients} patients`, stats.bills != null && `${stats.bills} bills`, stats.dataMB != null && `${stats.dataMB} MB`].filter(Boolean).join(" · ") || "—"}</dd>
            </dl>
          ) : (
            <p className="px-5 pb-5 text-sm text-slate-500">Not activated yet. Give the hospital its licence key and the Windows setup.</p>
          )}
          {c.installed && (
            <div className="border-t border-slate-100 px-5 py-3">
              <Button variant="secondary" onClick={() => setConfirm("reset-installation")}><RotateCcw className="size-4" /> Reset installation</Button>
              <p className="mt-1.5 text-xs text-slate-500">Deactivates the current computer so the key can be activated on a new one (e.g. after replacing the server PC).</p>
            </div>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            title="Payments"
            description={c.source ? `Came from: ${c.source}` : "Plan purchases and renewals of this hospital"}
            actions={<Button onClick={() => setPaying(true)}><IndianRupee className="size-4" /> Record payment</Button>}
          />
          {payments.data && payments.data.rows.length > 0 ? (
            <PaymentsTable rows={payments.data.rows} showClient={false} onChanged={() => { payments.reload(); q.reload(); }} />
          ) : (
            <p className="px-5 py-4 text-sm text-slate-500">No payments yet. The hospital can renew from its own app (Licence &amp; Sync → Renew), or record a payment you received here.</p>
          )}
        </Card>

        <Card>
          <CardHeader title="Branding" description="App name, logo, colour and letterhead for this hospital and its domain" actions={<Button variant="secondary" onClick={() => setBranding(true)}><Palette className="size-4" /> Edit</Button>} />
          {c.branding ? (
            <div className="flex items-start gap-4 px-5 pb-5 text-sm">
              {c.branding.logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.branding.logo} alt="" className="size-14 rounded-lg object-contain ring-1 ring-slate-200" />
              ) : (
                <div className="rounded-lg p-3 text-white" style={{ background: c.branding.color ?? "#16759a" }}><Hospital className="size-6" /></div>
              )}
              <div className="min-w-0 space-y-0.5">
                <p className="font-medium text-slate-900">{c.branding.appName ?? "MediCare"}{c.branding.color && <span className="ml-2 inline-block size-3 rounded-full align-middle ring-1 ring-slate-300" style={{ background: c.branding.color }} />}</p>
                {c.branding.tagline && <p className="text-slate-600">{c.branding.tagline}</p>}
                {c.branding.address && <p className="whitespace-pre-line text-slate-600">{c.branding.address}</p>}
                <p className="text-slate-500">{[c.branding.phone, c.branding.email, c.branding.website, c.branding.gstin && `GSTIN ${c.branding.gstin}`].filter(Boolean).join(" · ")}</p>
                {c.brandingAt && <p className="text-xs text-slate-400">Updated {timeAgo(c.brandingAt)}{c.lastSeenAt && c.lastSeenAt > c.brandingAt ? " · delivered" : " · sent at next check-in"}</p>}
              </div>
            </div>
          ) : (
            <p className="px-5 pb-5 text-sm text-slate-500">Default look. Add the hospital&apos;s logo, colour and address so its app and printed bills carry its own name.</p>
          )}
        </Card>

        <Card>
          <CardHeader title="Domain & DNS" actions={c.domain && <Button variant="secondary" onClick={() => run("check-dns", "DNS checked")} loading={busy === "check-dns"}><Globe className="size-4" /> Check DNS</Button>} />
          {c.domain ? (
            <div className="space-y-3 px-5 pb-5 text-sm">
              <p className="font-medium text-slate-900">{c.domain}</p>
              <div className="rounded-lg bg-slate-50 p-3 text-slate-700 ring-1 ring-slate-200">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Ask the client to add this DNS record</p>
                {c.dnsTarget ? (
                  <table className="mt-2 w-full font-mono text-xs">
                    <thead><tr className="text-left text-slate-500"><th className="pr-3">Type</th><th className="pr-3">Name</th><th>Value</th></tr></thead>
                    <tbody><tr><td className="pr-3">{/^\d+\.\d+\.\d+\.\d+$/.test(c.dnsTarget) ? "A" : "CNAME"}</td><td className="pr-3">{c.domain}</td><td>{c.dnsTarget}</td></tr></tbody>
                  </table>
                ) : (
                  <p className="mt-1">Set &quot;Domain points to&quot; (Edit) to the public IP of their server, or the host name you route it through.</p>
                )}
                <p className="mt-2 text-xs text-slate-500">HTTPS: the setup&apos;s optional web server gets a certificate automatically once this record works and ports 80/443 reach the server.</p>
              </div>
              {c.dnsCheck && (
                <div className="flex items-start gap-2">
                  {c.dnsCheck.ok ? <CheckCircle2 className="mt-0.5 size-4 text-emerald-600" /> : <XCircle className="mt-0.5 size-4 text-red-600" />}
                  <div>
                    <p className={c.dnsCheck.ok ? "text-emerald-800" : "text-red-800"}>{c.dnsCheck.message}</p>
                    {c.dnsCheck.found.length > 0 && <p className="font-mono text-xs text-slate-500">{c.dnsCheck.found.join(" · ")}</p>}
                    <p className="text-xs text-slate-400">Checked {timeAgo(c.dnsCheck.checkedAt)}</p>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="px-5 pb-5 text-sm text-slate-500">No custom domain. The hospital opens the app on its own network (e.g. http://server-pc:3010). Add a domain under Edit to give it a web address.</p>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Central data"
            description={c.syncEnabled ? `Database ${c.dbName}` : "Upload is turned off for this client"}
            actions={c.syncEnabled && c.installed && <Button variant="secondary" onClick={() => run("resync", "Full upload requested — it starts at their next check-in")} loading={busy === "resync"}><RefreshCw className="size-4" /> Full upload</Button>}
          />
          {data.data && data.data.collections.length > 0 ? (
            <div className="max-h-72 overflow-y-auto border-t border-slate-100">
              <table className="min-w-full text-sm">
                <tbody className="divide-y divide-slate-100">
                  {data.data.collections.map((col) => (
                    <tr key={col.name}>
                      <td className="px-5 py-1.5 font-mono text-xs text-slate-700">{col.name}</td>
                      <td className="px-5 py-1.5 text-right tabular-nums text-slate-700">{col.docs.toLocaleString("en-IN")}</td>
                      <td className="px-5 py-1.5 text-right text-xs text-slate-500">{c.synced[col.name]?.lastAt ? timeAgo(c.synced[col.name].lastAt) : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="flex items-center gap-2 px-5 pb-5 text-sm text-slate-500"><Database className="size-4" /> {c.installed ? "Nothing uploaded yet. Uploads run every 10 minutes while their app is online." : "Uploads start after activation."}</p>
          )}
          {c.lastSyncAt && <p className="border-t border-slate-100 px-5 py-2.5 text-xs text-slate-500"><Server className="mr-1 inline size-3.5" />Last upload {formatDateTime(c.lastSyncAt)}</p>}
        </Card>
      </div>

      {branding && (
        <BrandingForm
          name={c.name}
          branding={c.branding}
          onClose={() => setBranding(false)}
          onSubmit={async (b) => {
            await api(`/api/control/clients/${id}`, { method: "PATCH", body: { branding: b } });
            toast("Branding saved — the hospital's app picks it up at its next check-in");
            setBranding(false);
            q.reload();
          }}
        />
      )}
      {paying && (
        <RecordPaymentModal
          client={c}
          onClose={() => setPaying(false)}
          onDone={(p) => {
            toast(`Payment ${p.code} recorded — licence valid until ${formatDate(p.periodTo)}`);
            setPaying(false);
            payments.reload();
            q.reload();
          }}
        />
      )}
      {editing && (
        <ClientForm
          client={c}
          onClose={() => setEditing(false)}
          onSubmit={async (body) => {
            await api(`/api/control/clients/${id}`, { method: "PATCH", body });
            toast("Saved — the hospital's app picks it up at its next check-in");
            setEditing(false);
            q.reload();
          }}
        />
      )}
      <ConfirmDialog
        open={confirm !== null}
        title={confirm === "suspend" ? `Suspend ${c.name}?` : confirm === "activate" ? `Re-activate ${c.name}?` : confirm === "reset-installation" ? "Reset installation?" : "Issue a new licence key?"}
        message={
          confirm === "suspend" ? "Their app locks at its next check-in (within 10 minutes when online). Their data stays on their computer and here." :
          confirm === "activate" ? "Their app unlocks at its next check-in." :
          confirm === "reset-installation" ? `${c.lastHost ?? "The current computer"} is deactivated at its next check-in and must be activated again with the licence key. Use this when moving to a new computer.` :
          "The current key stops working for new activations. The installed computer keeps working."
        }
        confirmLabel={confirm === "suspend" ? "Suspend" : confirm === "activate" ? "Re-activate" : confirm === "reset-installation" ? "Reset" : "Issue new key"}
        danger={confirm === "suspend" || confirm === "reset-installation"}
        loading={!!busy}
        error={error}
        onConfirm={() => (confirm === "suspend" ? setStatus("Suspended") : confirm === "activate" ? setStatus("Active") : confirm && run(confirm, confirm === "reset-installation" ? "Installation reset" : "New key issued"))}
        onClose={() => setConfirm(null)}
      />
      {issuedKey && <LicenceKeyModal name={c.name} licenceKey={issuedKey} onClose={() => setIssuedKey(null)} />}
    </>
  );
}
