import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { alternates } from "@/lib/seo";
import { EgressRecorder } from "@/components/EgressPanel";

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

// The "What left this page" recorder runs on /convert only: mounted here, it starts with the page
// and puts fetch/sendBeacon/XHR back when the visitor navigates elsewhere. See EgressPanel.tsx.
export default function ConvertLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <EgressRecorder />
      {children}
    </>
  );
}
