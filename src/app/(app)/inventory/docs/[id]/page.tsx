"use client";

import { useParams } from "next/navigation";
import { DocView } from "@/components/inventory/DocView";

export default function StockDocPage() {
  const { id } = useParams<{ id: string }>();
  return <DocView key={id} id={id} />;
}
