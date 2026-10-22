import type { Metadata } from "next";
import { VoucherForm } from "@/components/accounts/VoucherForm";

export const metadata: Metadata = { title: "New voucher" };

// Session-checked, per-user data: allowed to block (see (app)/layout.tsx).
export const instant = false;

export default async function NewVoucherPage({ searchParams }: PageProps<"/accounts/vouchers/new">) {
  const { type } = await searchParams;
  return <VoucherForm initialType={typeof type === "string" ? type : undefined} />;
}
