"use client";

import { useParams } from "next/navigation";
import { LabBill, PrintFrame } from "@/components/laboratory/PrintViews";

export default function LabBillPage() {
  const { id } = useParams<{ id: string }>();
  return <PrintFrame url={`/api/laboratory/orders/${id}`} kind="bill" back={`/laboratory/orders/${id}`}>{(o) => <LabBill order={o} />}</PrintFrame>;
}
