"use client";

import { useParams, useSearchParams } from "next/navigation";
import { Payslips } from "@/components/hr/Payslips";

export default function PayslipsPage() {
  const { id } = useParams<{ id: string }>();
  const staff = useSearchParams().get("staff");
  return <Payslips id={id} staff={staff} />;
}
