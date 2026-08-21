/** BedReady mark: a build plate (rounded square + bed-grid hint) with a "ready" checkmark,
    tinted with the spectrum brand sweep (violet → cyan → lime). */
export default function Logo({ size = 26, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden
    >
      <defs>
        {/* Fixed id is safe: any duplicate instances resolve to this identical definition. */}
        <linearGradient id="brLogoSweep" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7c3aed" />
          <stop offset="0.55" stopColor="#06b6d4" />
          <stop offset="1" stopColor="#84cc16" />
        </linearGradient>
      </defs>
      <rect x="2.5" y="2.5" width="27" height="27" rx="7.5" fill="#0f172a" stroke="#27324a" strokeWidth="1.5" />
      {/* heated-bed grid hint */}
      <path d="M8 23h16M8 26h16" stroke="url(#brLogoSweep)" strokeWidth="1.5" strokeLinecap="round" opacity="0.4" />
      {/* "ready" check */}
      <path d="M9.5 16.5l4 4 9-10" stroke="url(#brLogoSweep)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
