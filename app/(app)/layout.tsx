import { NavBar } from "../../components/NavBar";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // safe-x and safe-bottom replace the flat px-5/pb-16: with
    // `viewport-fit: cover` set in the root layout the page now paints under
    // the notch and the home indicator, and these keep content clear of both.
    // On anything without insets they resolve to the same 20px and 3.5rem.
    <div className="safe-x safe-bottom mx-auto min-h-[100dvh] w-full max-w-md">
      <NavBar />
      {children}
    </div>
  );
}
