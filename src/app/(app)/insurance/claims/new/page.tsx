import type { Metadata } from "next";
import { connection } from "next/server";
import { ClaimForm } from "@/components/insurance/ClaimForm";
import { connectDB } from "@/lib/db";
import { isObjectId } from "@/lib/validation";
import { getRecordModel } from "@/models/records";

export const metadata: Metadata = { title: "New claim" };

// Session-checked, per-user data: allowed to block (see (app)/layout.tsx).
export const instant = false;

export default async function NewClaimPage({ searchParams }: PageProps<"/insurance/claims/new">) {
  const { patient } = await searchParams;
  let initialPatient: { id: string; label: string; code?: string } | undefined;
  if (typeof patient === "string" && isObjectId(patient)) {
    // Reading the database is request-time work, not part of the prerendered shell.
    await connection();
    await connectDB();
    const p = await getRecordModel("patients", "patients")!.findById(patient).select("fullName code").lean<Record<string, unknown>>();
    if (p) initialPatient = { id: patient, label: String(p.fullName), code: p.code as string };
  }
  return <ClaimForm initialPatient={initialPatient} />;
}
