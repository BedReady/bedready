"use client";

import { useEffect } from "react";
import { captureAcquisition } from "@/lib/acquisition";

/**
 * Records which channel brought this visit, once, on arrival.
 *
 * Mounted beside <Analytics /> in the layout because it is the same concern: it adds a channel label
 * to events Vercel already collects. It writes nothing on a visit that already has a live label —
 * that is what makes it first touch, and first touch is the point. Someone who arrives from a forum,
 * returns a week later by typing the address and only then uploads was brought here by the forum;
 * last-touch would file that upload under "direct" and make every channel look worthless.
 */
export default function AcquisitionCapture() {
  useEffect(() => {
    captureAcquisition();
  }, []);
  return null;
}
