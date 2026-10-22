"use client";

import { useParams } from "next/navigation";
import { VoucherView } from "@/components/accounts/VoucherView";

export default function VoucherPage() {
  const { id } = useParams<{ id: string }>();
  return <VoucherView id={id} />;
}
