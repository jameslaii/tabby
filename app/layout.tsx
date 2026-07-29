import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tabby — split the bill, not the friendship",
  description:
    "Snap the receipt, say who had what, and Tabby does the itemized math.",
};

export const viewport: Viewport = {
  themeColor: "#FDF7F0",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
