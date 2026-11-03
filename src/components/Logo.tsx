/** BedReady mark: the U1 seen head-on — four toolheads, one per filament slot, parked over a build
    plate. The slot colours are fixed (cyan, magenta, yellow, black) and match `--slot-1…4` in
    globals.css; the plate is the same dark PEI as the converter's drop zone, in either theme. */
export default function Logo({ size = 26, className = "" }: { size?: number; className?: string }) {
  const heads = ["#00a3d9", "#e6007e", "#ffd200", "#f4f2ec"];
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={className} aria-hidden>
      <rect x="1" y="1" width="30" height="30" rx="8" fill="#1d1b17" />
      {heads.map((c, i) => (
        <path key={c} d={`M${6.5 + i * 5.25} 8h3.5v6.5l-1.75 2.25-1.75-2.25z`} fill={c} />
      ))}
      <rect x="5" y="22" width="22" height="3" rx="1.5" fill="#c9a86a" />
    </svg>
  );
}
