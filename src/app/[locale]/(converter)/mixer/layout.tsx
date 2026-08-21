import type { ReactNode } from "react";
import { alternates } from "@/lib/seo";

// The mixer page is a client component and can't export metadata itself, so its title/description live
// here (this layout is server-rendered).
export const metadata = {
  title: "Full Spectrum color mixer — BedReady",
  description:
    "Preview the colors you can mix from your 4 loaded filaments on the Snapmaker U1 — see the Full Spectrum gamut before you print. Free, in your browser.",
  alternates: alternates("/mixer"),
};

export default function MixerLayout({ children }: { children: ReactNode }) {
  return children;
}
