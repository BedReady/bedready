/** T1–T4, the U1's four toolheads, parked along the top edge of a `.plate` drop zone in the slot
    colours (globals.css, "The plate"). They lower toward the plate while a file is held over it,
    driven by the plate's `data-over`. Decorative: the plate's own text is what a screen reader reads.
    Always left to right, T1 first, in Arabic too: this is the machine's physical order, not reading order. */
export default function PlateHeads() {
  return (
    <div className="plate-heads" aria-hidden="true" dir="ltr">
      {[1, 2, 3, 4].map((n) => (
        <span key={n} className="plate-head" style={{ ["--head" as string]: `var(--slot-${n})` }}>
          <span className="plate-head-label">T{n}</span>
          <span className="plate-head-body" />
          <span className="plate-head-tip" />
        </span>
      ))}
    </div>
  );
}
