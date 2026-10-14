"use client";

import { useParams, useSearchParams } from "next/navigation";
import { PrintFrame, SampleLabels } from "@/components/laboratory/PrintViews";

export default function LabLabelsPage() {
  const { id } = useParams<{ id: string }>();
  const sample = useSearchParams().get("sample");
  return <PrintFrame url={`/api/laboratory/orders/${id}`} kind="labels" back={`/laboratory/orders/${id}`}>{(o) => <SampleLabels order={o} only={sample} />}</PrintFrame>;
}
