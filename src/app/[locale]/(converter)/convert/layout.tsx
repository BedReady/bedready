import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { alternates } from "@/lib/seo";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "convert" });
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: alternates("/convert", locale),
  };
}

export default function ConvertLayout({ children }: { children: React.ReactNode }) {
  return children;
}
