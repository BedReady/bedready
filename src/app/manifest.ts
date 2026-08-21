import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "BedReady",
    short_name: "BedReady",
    description:
      "Machine-agnostic 3D-print files and tested print profiles, starting with the Snapmaker U1.",
    start_url: "/",
    display: "standalone",
    background_color: "#0b1120",
    theme_color: "#f97316",
    icons: [{ src: "/icon.svg", type: "image/svg+xml", sizes: "any" }],
  };
}
