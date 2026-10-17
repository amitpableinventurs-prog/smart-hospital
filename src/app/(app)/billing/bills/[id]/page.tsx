"use client";

import { useParams } from "next/navigation";
import { BillView } from "@/components/billing/BillView";

export default function BillPage() {
  const { id } = useParams<{ id: string }>();
  return <BillView id={id} />;
}
