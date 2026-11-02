import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { alternates } from "@/lib/seo";
import AppJsonLd from "@/components/AppJsonLd";

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

export default async function CalibrateLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return (
    <>
      <AppJsonLd locale={locale} namespace="calibrate" path="/calibrate" />
      {children}
    </>
  );
}
