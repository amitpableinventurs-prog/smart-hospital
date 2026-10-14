"use client";

import { useParams } from "next/navigation";
import { PrintFrame } from "@/components/laboratory/PrintViews";
import { ReportDocument } from "@/components/laboratory/ReportDocument";

export default function LabReportPage() {
  const { id } = useParams<{ id: string }>();
  return <PrintFrame url={`/api/laboratory/orders/${id}`} kind="report" back={`/laboratory/orders/${id}`}>{(o) => <ReportDocument order={o} />}</PrintFrame>;
}
