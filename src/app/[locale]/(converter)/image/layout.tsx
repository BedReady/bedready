import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { alternates } from "@/lib/seo";

// `page.tsx` is a client component and so can't export metadata itself — same reason /convert and
// /mixer carry a layout. Localized, because the page body is translated and an English SERP snippet
// on /de/image wastes the page.
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "image" });
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: alternates("/image", locale),
  };
}

export default function ImageLayout({ children }: { children: React.ReactNode }) {
  return children;
}
