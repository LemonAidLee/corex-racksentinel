import type { Metadata } from "next";
import { SiteShell } from "@/components/site/SiteShell";
import DataFlowPage from "@/components/flow/DataFlowPage";
import "../site.css";

export const metadata: Metadata = {
  title: "Data flow · RackSentinel",
  description: "Each RackSentinel test case byte by byte: the packets the AWS host sends, the CRC check, the firmware's decisions and the replies.",
};

export default function Page() {
  return (
    <SiteShell>
      <DataFlowPage />
    </SiteShell>
  );
}
