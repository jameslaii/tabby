import type { Metadata } from "next";
import Link from "next/link";
import { Wordmark } from "../components/Logo";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tabby — split the bill, not the friendship",
  description:
    "Snap the receipt, say who had what, and Tabby does the itemized math.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <div className="mx-auto min-h-screen w-full max-w-2xl px-5 pb-24">
          <header className="flex items-center justify-between py-7">
            <Link href="/" aria-label="Tabby home">
              <Wordmark />
            </Link>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
