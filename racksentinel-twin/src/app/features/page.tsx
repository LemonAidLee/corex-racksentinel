import type { Metadata } from "next";
import { SiteShell } from "@/components/site/SiteShell";
import FeaturesPage from "@/components/features/FeaturesPage";
import "../site.css";

export const metadata: Metadata = {
  title: "Features · RackSentinel",
  description: "Every feature of RackSentinel v2 in plain words: why it matters, why it stands out, and a live demo on the verified chip model.",
};

export default function Page() {
  return (
    <SiteShell>
      <FeaturesPage />
    </SiteShell>
  );
}
