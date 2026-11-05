import type { Metadata, Viewport } from "next";
import { Exo_2, IBM_Plex_Mono, IBM_Plex_Sans, Silkscreen } from "next/font/google";
import "./globals.css";

const pixel = Silkscreen({ weight: ["400", "700"], subsets: ["latin"], variable: "--font-pixel", display: "swap" });
const sans = IBM_Plex_Sans({ weight: ["400", "500", "600"], subsets: ["latin"], variable: "--font-sans", display: "swap" });
const mono = IBM_Plex_Mono({ weight: ["400", "600"], subsets: ["latin"], variable: "--font-mono", display: "swap" });
/** Squared lettering for the ChampionCHIP eXperience door mat and the CoreX plaque in the room. */
const logo = Exo_2({ weight: ["600", "800"], subsets: ["latin"], variable: "--font-logo", display: "swap" });

export const metadata: Metadata = {
  title: "RackSentinel Digital Twin",
  description:
    "Interactive behavioral digital twin of RackSentinel, a RISC-V rack safety controller with a latched EPO request. Simulation only.",
};

export const viewport: Viewport = { themeColor: "#101318", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${pixel.variable} ${sans.variable} ${mono.variable} ${logo.variable}`}>
      <body>{children}</body>
    </html>
  );
}
