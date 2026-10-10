import { PharmacyHome } from "@/components/pharmacy/PharmacyHome";

// Session-checked, per-user data: allowed to block (see (app)/layout.tsx).
export const instant = false;

export default async function PharmacyPage({ searchParams }: PageProps<"/pharmacy">) {
  const { tab } = await searchParams;
  return <PharmacyHome initialTab={tab === "purchases" ? "purchases" : "sales"} />;
}
