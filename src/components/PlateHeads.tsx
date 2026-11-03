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

/** The build area's four corner marks, in the plate's brass (Figma: Plate → Corner TL/TR/BR/BL).
    They make the dark panel read as a bed with an edge to print inside, not as a black box. */
export function PlateCorners() {
  const corner = "absolute h-4 w-4 border-[#c9a86a]/55";
  return (
    <span aria-hidden="true">
      <span className={`${corner} left-4 top-4 rounded-tl-[3px] border-l-[1.5px] border-t-[1.5px]`} />
      <span className={`${corner} right-4 top-4 rounded-tr-[3px] border-r-[1.5px] border-t-[1.5px]`} />
      <span className={`${corner} bottom-4 right-4 rounded-br-[3px] border-b-[1.5px] border-r-[1.5px]`} />
      <span className={`${corner} bottom-4 left-4 rounded-bl-[3px] border-b-[1.5px] border-l-[1.5px]`} />
    </span>
  );
}
