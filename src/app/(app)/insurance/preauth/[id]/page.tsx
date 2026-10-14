"use client";

import { useParams } from "next/navigation";
import { PreauthView } from "@/components/insurance/PreauthView";

export default function PreauthPage() {
  const { id } = useParams<{ id: string }>();
  return <PreauthView id={id} />;
}
