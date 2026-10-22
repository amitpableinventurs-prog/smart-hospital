import type { Metadata } from "next";
import { Hospital } from "lucide-react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { activationNeeds } from "@/lib/licence";
import { SetupForm } from "./SetupForm";

// Reads the installation's licence state on every request.
export const instant = false;

export const metadata: Metadata = { title: "Activate" };

/** First run of a client installation: licence key and, on a fresh install, the hospital's super admin. */
export default async function SetupPage() {
  // Depends on this installation's database, never on the build.
  await connection();
  const needs = await activationNeeds();
  if (!needs.canActivate) redirect("/login");
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-2">
          <div className="rounded-lg bg-brand-600 p-1.5 text-white"><Hospital className="size-5" aria-hidden /></div>
          <span className="text-lg font-semibold text-slate-900">MediCare</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Activate this installation</h1>
        <p className="mt-1 text-sm text-slate-500">Enter the licence key from your vendor, or start a free trial.</p>
        <SetupForm needsAdmin={needs.needsAdmin} controlUrl={needs.controlUrl} />
      </div>
    </div>
  );
}
