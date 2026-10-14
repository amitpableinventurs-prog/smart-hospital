import type { Metadata } from "next";
import { PreauthForm } from "@/components/insurance/PreauthForm";
import { connectDB } from "@/lib/db";
import { isObjectId } from "@/lib/validation";
import { getRecordModel } from "@/models/records";

export const metadata: Metadata = { title: "New pre-authorisation" };

// Session-checked, per-user data: allowed to block (see (app)/layout.tsx).
export const instant = false;

export default async function NewPreauthPage({ searchParams }: PageProps<"/insurance/preauth/new">) {
  const { patient } = await searchParams;
  let initialPatient: { id: string; label: string; code?: string } | undefined;
  if (typeof patient === "string" && isObjectId(patient)) {
    await connectDB();
    const p = await getRecordModel("patients", "patients")!.findById(patient).select("fullName code").lean<Record<string, unknown>>();
    if (p) initialPatient = { id: patient, label: String(p.fullName), code: p.code as string };
  }
  return <PreauthForm initialPatient={initialPatient} />;
}
