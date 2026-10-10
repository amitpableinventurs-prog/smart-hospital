import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "MediCare – Hospital Management ERP", template: "%s · MediCare" },
  description: "Smart hospital automation: patients, OPD/IPD, doctors, nursing, laboratory, inventory, billing, HR, insurance and ambulance.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      {/* Browser extensions (e.g. ColorZilla's cz-shortcut-listen) add attributes to <body> before hydration. */}
      <body className="min-h-full font-sans" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
