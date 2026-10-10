import type { Metadata } from "next";
import { PurchaseForm } from "@/components/pharmacy/PurchaseForm";

export const metadata: Metadata = { title: "New purchase entry" };

export default function NewPurchasePage() {
  return <PurchaseForm />;
}
