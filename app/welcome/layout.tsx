/**
 * Onboarding runs full-bleed — no app header, no max-width gutter, so the
 * hero composition owns the whole screen.
 */
export default function WelcomeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="mx-auto w-full max-w-md">{children}</div>;
}
