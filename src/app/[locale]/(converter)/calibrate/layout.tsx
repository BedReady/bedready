import type { Metadata } from "next";
import { alternates } from "@/lib/seo";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return {
    title: "Filament calibration card — measure TD for photographic relief prints",
    description:
      "Generate a printable calibration card for the Snapmaker U1 that measures a filament's transmission distance (TD) — the constant photographic relief printing depends on. Print it, photograph it, and get a real number instead of an estimate. Free, runs in your browser.",
    alternates: alternates("/calibrate", locale),
  };
}

export default function CalibrateLayout({ children }: { children: React.ReactNode }) {
  return children;
}
