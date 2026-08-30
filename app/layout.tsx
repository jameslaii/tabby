import type { Metadata, Viewport } from "next";
import "./globals.css";
import { StoreProvider } from "../components/StoreProvider";

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
      <body>
        {/* At the root so onboarding, which sits outside the app layout, can
            read the same groups the rest of the app does. */}
        <StoreProvider>{children}</StoreProvider>
      </body>
    </html>
  );
}
