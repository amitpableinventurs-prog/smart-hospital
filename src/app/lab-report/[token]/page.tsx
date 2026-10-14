import type { Metadata } from "next";
import { SharedReport } from "@/components/laboratory/SharedReport";

export const metadata: Metadata = { title: "Lab report", robots: { index: false, follow: false } };

// Looked up by token on every request; nothing here can be prerendered.
export const instant = false;

/** Public report opened from a shared link (no sign-in; approved results only). */
export default async function SharedLabReportPage({ params }: PageProps<"/lab-report/[token]">) {
  const { token } = await params;
  return <SharedReport token={token} />;
}
