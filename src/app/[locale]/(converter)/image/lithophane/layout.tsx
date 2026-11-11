import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { alternates } from "@/lib/seo";
import AppJsonLd from "@/components/AppJsonLd";

// `page.tsx` is a client component and so can't export metadata itself — same reason /convert and
// /mixer carry a layout. Localized, because the page body is translated and an English SERP snippet
// on /de/image/lithophane wastes the page.
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "lithophane" });
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: alternates("/image/lithophane", locale),
  };
}

export default async function LithophaneLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return (
    <>
      <AppJsonLd locale={locale} namespace="lithophane" path="/image/lithophane" />
      {children}
    </>
  );
}
