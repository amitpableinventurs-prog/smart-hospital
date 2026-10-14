"use client";

import { useParams } from "next/navigation";
import { ClaimView } from "@/components/insurance/ClaimView";

export default function ClaimPage() {
  const { id } = useParams<{ id: string }>();
  return <ClaimView id={id} />;
}
