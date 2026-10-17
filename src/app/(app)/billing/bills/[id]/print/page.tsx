"use client";

import { useParams } from "next/navigation";
import { BillPrint } from "@/components/billing/BillPrint";

export default function BillPrintPage() {
  const { id } = useParams<{ id: string }>();
  return <BillPrint id={id} />;
}
