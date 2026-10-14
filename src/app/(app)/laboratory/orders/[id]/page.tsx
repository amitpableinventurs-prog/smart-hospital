"use client";

import { useParams } from "next/navigation";
import { OrderView } from "@/components/laboratory/OrderView";

export default function LabOrderPage() {
  const { id } = useParams<{ id: string }>();
  return <OrderView id={id} />;
}
