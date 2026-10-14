"use client";

import { useParams } from "next/navigation";
import { TripView } from "@/components/ambulance/TripView";

export default function TripPage() {
  const { id } = useParams<{ id: string }>();
  return <TripView id={id} />;
}
