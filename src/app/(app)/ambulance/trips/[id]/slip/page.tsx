"use client";

import { useParams } from "next/navigation";
import { TripSlip } from "@/components/ambulance/TripSlip";

export default function TripSlipPage() {
  const { id } = useParams<{ id: string }>();
  return <TripSlip id={id} />;
}
