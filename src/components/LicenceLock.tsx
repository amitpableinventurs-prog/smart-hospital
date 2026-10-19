"use client";

import { BadgeAlert, Info, LockKeyhole, LogOut, RefreshCw, WifiOff } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client";
import type { LicenceView } from "@/lib/licence-protocol";
import { Alert, Button, Card } from "./ui";

/** Full-page screen of a client installation whose licence does not allow use right now. */
export function LicenceLock({ licence, user }: { licence: LicenceView; user: { name: string; email: string; role: string } }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reason = licence.locked?.reason;

  async function checkAgain() {
    setBusy(true);
    setError(null);
    try {
      const { data } = await api<{ ok: boolean; error?: string; licence: LicenceView }>("/api/licence/check", { method: "POST" });
      if (data.licence.locked) setError(data.error ?? data.licence.locked.message);
      else router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <Card className="w-full max-w-lg p-8">
        <div className="mb-4 inline-flex rounded-xl bg-amber-50 p-3 text-amber-700">
          {reason === "offline" ? <WifiOff className="size-6" /> : <LockKeyhole className="size-6" />}
        </div>
        <h1 className="text-xl font-semibold text-slate-900">
          {reason === "offline" ? "Licence check needed" : reason === "expired" ? "Licence expired" : reason === "deactivated" ? "Installation deactivated" : "Licence suspended"}
        </h1>
        {licence.hospitalName && <p className="mt-1 text-sm text-slate-500">{licence.hospitalName}{licence.clientCode ? ` · ${licence.clientCode}` : ""}</p>}
        <p className="mt-4 text-sm text-slate-700">{licence.locked?.message}</p>
        <p className="mt-2 text-xs text-slate-500">Your data is safe on this computer; nothing has been deleted.</p>
        {error && <div className="mt-4"><Alert>{error}</Alert></div>}
        <div className="mt-6 flex flex-wrap gap-2">
          {reason === "deactivated" ? (
            user.role === "super_admin" && <Link href="/setup" className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-700">Activate again</Link>
          ) : (
            <Button onClick={checkAgain} loading={busy}><RefreshCw className="size-4" /> Check again</Button>
          )}
          <Button variant="secondary" onClick={signOut}><LogOut className="size-4" /> Sign out</Button>
        </div>
        <p className="mt-6 text-xs text-slate-400">Signed in as {user.name} ({user.email})</p>
      </Card>
    </div>
  );
}

/** Vendor notice, expiry and offline warnings above every page of a client installation. */
export function LicenceBanner({ licence }: { licence: LicenceView }) {
  if (licence.mode !== "client") return null;
  const items: { tone: "amber" | "blue"; text: string }[] = [];
  if (licence.notice) items.push({ tone: "blue", text: licence.notice });
  const days = licence.expiresInDays;
  if (licence.expiresAt && days !== null && days <= 15) {
    items.push({ tone: "amber", text: `Your licence expires in ${days} day${days === 1 ? "" : "s"} (${licence.expiresAt.slice(0, 10)}). Contact your vendor to renew.` });
  }
  if (licence.offlineDaysLeft !== null && (licence.offlineDays ?? 0) >= 1) {
    items.push({ tone: "amber", text: `Working offline. Connect to the internet within ${licence.offlineDaysLeft} day${licence.offlineDaysLeft === 1 ? "" : "s"} to keep using the app.` });
  }
  if (!items.length) return null;
  return (
    <div className="mb-4 space-y-2 print:hidden">
      {items.map((i) => (
        <div key={i.text} className={i.tone === "amber" ? "flex items-start gap-2 rounded-lg bg-amber-50 px-4 py-2.5 text-sm text-amber-900 ring-1 ring-amber-200" : "flex items-start gap-2 rounded-lg bg-brand-50 px-4 py-2.5 text-sm text-brand-900 ring-1 ring-brand-200"}>
          {i.tone === "amber" ? <BadgeAlert className="mt-0.5 size-4 shrink-0" /> : <Info className="mt-0.5 size-4 shrink-0" />}
          {i.text}
        </div>
      ))}
    </div>
  );
}
