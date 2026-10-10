import type { Metadata } from "next";
import { Hospital } from "lucide-react";
import { LoginForm } from "./LoginForm";

// Every request re-checks the session against the database (deactivation and
// module changes apply immediately), so these routes intentionally block.
export const instant = false;

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  // Only allow same-site relative redirects.
  const safeNext = typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : undefined;

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden flex-col justify-between bg-brand-900 p-12 text-white lg:flex">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-white/10 p-2">
            <Hospital className="size-6" aria-hidden />
          </div>
          <span className="text-lg font-semibold">MediCare</span>
        </div>
        <div>
          <h1 className="text-3xl font-semibold leading-tight">Smart hospital automation,<br />one panel per department.</h1>
          <p className="mt-4 max-w-md text-brand-100">
            Patients, OPD/IPD, doctors, nursing, laboratory, inventory, billing, HR, insurance and ambulance — each managed by its assigned admins, with full oversight for the super admin.
          </p>
        </div>
        <p className="text-xs text-brand-200">Access is restricted to authorised hospital staff. All activity is recorded.</p>
      </div>

      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2 lg:hidden">
            <div className="rounded-lg bg-brand-600 p-1.5 text-white">
              <Hospital className="size-5" aria-hidden />
            </div>
            <span className="text-lg font-semibold text-slate-900">MediCare</span>
          </div>
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Sign in</h2>
          <p className="mt-1 text-sm text-slate-500">Use the account provided by your super admin.</p>
          <LoginForm next={safeNext} />
        </div>
      </div>
    </div>
  );
}
