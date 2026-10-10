import type { Metadata } from "next";
import { SaleBillForm } from "@/components/pharmacy/SaleBillForm";
import { connectDB } from "@/lib/db";
import { isObjectId } from "@/lib/validation";
import { getRecordModel } from "@/models/records";

export const metadata: Metadata = { title: "New sale bill" };

// Session-checked, per-user data: allowed to block (see (app)/layout.tsx).
export const instant = false;

export default async function NewSalePage({ searchParams }: PageProps<"/pharmacy/new">) {
  const { patient } = await searchParams;
  let initialPatient: { id: string; label: string; code?: string; phone?: string } | undefined;
  if (typeof patient === "string" && isObjectId(patient)) {
    await connectDB();
    const p = await getRecordModel("patients", "patients")!.findById(patient).select("fullName code mobile").lean<Record<string, unknown>>();
    if (p) initialPatient = { id: patient, label: String(p.fullName), code: p.code as string, phone: p.mobile as string };
  }
  return <SaleBillForm initialPatient={initialPatient} />;
}
