import type { Metadata } from "next";
import { alternates } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Free 3MF → U1 converter — BedReady",
  description:
    "Your file never leaves your browser — no upload, no server. Convert any .3mf to a clean Snapmaker U1 file: strips foreign Bambu/Prusa/Creality profiles, stamps the real U1 profile, preserves painted colors. Free.",
  alternates: alternates("/convert"),
};

export default function ConvertLayout({ children }: { children: React.ReactNode }) {
  return children;
}
