/** The Tabby mark, redrawn as inline SVG from the brand sheet. */
export function TabbyMark({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="17" fill="#1F5F5B" />
      {/* ears */}
      <path d="M17 26 L18.5 12 L30 20 Z" fill="#D9730D" />
      <path d="M47 26 L45.5 12 L34 20 Z" fill="#D9730D" />
      <path d="M20 24 L21 16 L28.5 21 Z" fill="#F5D9B0" />
      <path d="M44 24 L43 16 L35.5 21 Z" fill="#F5D9B0" />
      {/* face */}
      <circle cx="32" cy="35" r="17" fill="#D9730D" />
      {/* forehead tabby stripes */}
      <path
        d="M23 28 q4.5 -6 9 0 M32 28 q4.5 -6 9 0"
        stroke="#F5D9B0"
        strokeWidth="2.6"
        strokeLinecap="round"
        fill="none"
      />
      {/* closed happy eyes */}
      <path
        d="M23.5 36 q3.5 4 7 0 M33.5 36 q3.5 4 7 0"
        stroke="#2A211C"
        strokeWidth="2.4"
        strokeLinecap="round"
        fill="none"
      />
      {/* cheeks + nose */}
      <circle cx="21.5" cy="40" r="3.1" fill="#B85A0A" opacity="0.45" />
      <circle cx="42.5" cy="40" r="3.1" fill="#B85A0A" opacity="0.45" />
      <path d="M30 43 L34 43 L32 46 Z" fill="#2A211C" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <div className="flex items-center gap-3">
      <TabbyMark size={38} />
      <div className="leading-none">
        <div className="text-[26px] font-extrabold tracking-tight text-ink">
          Tabby
        </div>
        <div className="mt-1 text-[9px] font-bold uppercase tracking-[0.16em] text-teal">
          Split the bill, not the friendship
        </div>
      </div>
    </div>
  );
}
