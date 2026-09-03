import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lead Intel — AheadTech360",
  description: "Local business lead intelligence.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
