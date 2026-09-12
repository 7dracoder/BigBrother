import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "BigBrother — Be here. We’ll remember.",
  description:
    "An ambient companion that catches commitments, proposes actions, and remembers the conversation. Always your call.",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
