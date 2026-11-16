import { ShieldAlert } from "lucide-react";
import Link from "next/link";

export function AccessDenied({ moduleLabel }: { moduleLabel?: string }) {
  return (
    <div className="mx-auto mt-16 max-w-md rounded-2xl border border-slate-200/80 bg-white p-8 text-center shadow-card">
      <div className="mx-auto w-fit rounded-2xl bg-amber-50 p-4 ring-1 ring-inset ring-amber-100">
        <ShieldAlert className="size-6 text-amber-600" aria-hidden />
      </div>
      <h1 className="mt-4 text-lg font-semibold text-slate-900">Access restricted</h1>
      <p className="mt-2 text-sm text-slate-500">
        You are not assigned to {moduleLabel ? <strong>{moduleLabel}</strong> : "this module"}. Ask the super admin to allocate it to your account.
      </p>
      <Link href="/" className="mt-6 inline-block text-sm font-medium text-brand-700 hover:underline">
        Back to dashboard
      </Link>
    </div>
  );
}
