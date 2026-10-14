"use client";

import { useParams } from "next/navigation";
import { PayrollView } from "@/components/hr/PayrollView";

export default function PayrollPage() {
  const { id } = useParams<{ id: string }>();
  return <PayrollView id={id} />;
}
