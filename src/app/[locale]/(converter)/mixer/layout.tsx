import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { alternates } from "@/lib/seo";

// The mixer page is a client component and can't export metadata itself, so its title/description live
// here (this layout is server-rendered).
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "mixer" });
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: alternates("/mixer", locale),
  };
}

export default function MixerLayout({ children }: { children: ReactNode }) {
  return children;
}
