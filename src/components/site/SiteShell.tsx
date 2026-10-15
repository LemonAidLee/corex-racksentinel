"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Icon } from "../icons";

const LINKS = [
  { href: "/", label: "Digital twin", icon: "play" as const },
  { href: "/features", label: "Features", icon: "book" as const },
  { href: "/data-flow", label: "Data flow", icon: "flow" as const },
];

/** Scrolling page shell for the explainer pages: one-line nav, content, footer. */
export function SiteShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  return (
    <div className="site">
      <header className="site-nav">
        <div className="site-wrap site-nav-row">
          <Link href="/" className="site-brand" aria-label="RackSentinel digital twin">RackSentinel</Link>
          <nav aria-label="Pages">
            <ul className="site-links">
              {LINKS.map((l) => {
                const current = path === l.href;
                return (
                  <li key={l.href}>
                    <Link href={l.href} className="site-link" aria-current={current ? "page" : undefined}>
                      <Icon name={l.icon} size={16} /> {l.label}
                      {!current && <span className="site-link-go" aria-hidden="true"><Icon name="arrow" size={13} weight="bold" /></span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        </div>
      </header>
      <main className="site-main">{children}</main>
      <footer className="site-foot">
        <div className="site-wrap">
          Team CoreX, Equipe 31 · ChampionCHIP eXperience Malaysia 2026. Behaviour modelled from the v2 firmware and checked against the nine runs that passed on the AWS FPGA.
        </div>
      </footer>
    </div>
  );
}
