import type { Metadata, Viewport } from "next";
import { DM_Mono, Fraunces, Instrument_Sans } from "next/font/google";
import "./globals.css";
import { StoreProvider } from "../components/StoreProvider";

/**
 * Three faces, three jobs.
 *
 * Until now the stack named Nunito and Quicksand without ever loading them, so
 * every device fell through to whatever it had — `ui-rounded` on an iPhone,
 * something else on a laptop. The app had no typeface of its own, which is most
 * of why it read as generic: the system UI font is what every other app uses.
 *
 * Fraunces carries the one headline per screen. DM Mono carries every number
 * and every small label, because money set in a proportional font reads as
 * marketing and money set in a monospace reads as a ledger. Instrument Sans
 * does the ordinary talking in between.
 */
const display = Fraunces({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-display",
});

const sans = Instrument_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});

const mono = DM_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "Tabby — split the bill, not the friendship",
  description:
    "Snap the receipt, say who had what, and Tabby does the itemized math.",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Tabby" },
};

export const viewport: Viewport = {
  themeColor: "#F7F2E9",
  width: "device-width",
  initialScale: 1,
  // Lets the page paint under the notch and the home indicator; the safe-area
  // insets in globals.css then keep content clear of both. Without this the
  // insets are always zero and the layout can't know where the hardware is.
  viewportFit: "cover",
  // Deliberately not user-scalable:no — pinch-zoom is an accessibility
  // affordance, and the 16px inputs already stop Safari zooming on its own.
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${sans.variable} ${mono.variable}`}
    >
      <body>
        {/* At the root so onboarding, which sits outside the app layout, can
            read the same groups the rest of the app does. */}
        <StoreProvider>{children}</StoreProvider>
      </body>
    </html>
  );
}
