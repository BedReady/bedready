import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { alternates } from "@/lib/seo";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "calibrate" });
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: alternates("/calibrate", locale),
  };
}

export default function CalibrateLayout({ children }: { children: React.ReactNode }) {
  return children;
}
