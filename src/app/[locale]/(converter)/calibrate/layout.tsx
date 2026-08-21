import { alternates } from "@/lib/seo";

export const metadata = {
  title: "Filament calibration card — measure TD for photographic relief prints",
  description:
    "Generate a printable calibration card for the Snapmaker U1 that measures a filament's transmission distance (TD) — the constant photographic relief printing depends on. Print it, photograph it, and get a real number instead of an estimate. Free, runs in your browser.",
  alternates: alternates("/calibrate"),
};

export default function CalibrateLayout({ children }: { children: React.ReactNode }) {
  return children;
}
