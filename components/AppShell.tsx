"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import Sidebar, { isActive, newChat } from "./Sidebar";
import { Icon, LogoMark } from "./ui";
import ProjectSwitcher from "./ProjectSwitcher";
import DeviceSync from "./DeviceSync";
import NotificationBell from "./NotificationBell";

const TABS_LEFT = [
  { href: "/", label: "Accueil", icon: "space_dashboard" },
  { href: "/projets", label: "Projets", icon: "folder_special" },
];
const TABS_RIGHT = [
  { href: "/fichiers", label: "Fichiers", icon: "folder_open" },
  { href: "/memoire", label: "Mémoire", icon: "memory" },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const analyzing = isActive(pathname, "/chat");

  const tab = (t: { href: string; label: string; icon: string }) => {
    const active = isActive(pathname, t.href);
    return (
      <Link
        key={t.href}
        href={t.href}
        className={`flex-1 flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${active ? "text-ink" : "text-muted"}`}
      >
        <Icon name={t.icon} filled={active} className="text-[22px]" />
        {t.label}
      </Link>
    );
  };

  return (
    <div className="h-dvh flex">
      <DeviceSync />
      <Sidebar open={open} onClose={() => setOpen(false)} />
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Barre du haut (mobile) */}
        <header className="md:hidden flex items-center gap-2 border-b border-line glass px-4 h-14 shrink-0 relative z-30">
          <span className="grid place-items-center rounded-lg bg-soft border border-line p-1">
            <LogoMark size={24} />
          </span>
          <div className="flex-1 min-w-0">
            <ProjectSwitcher variant="header" />
          </div>
          <NotificationBell />
          <button onClick={() => setOpen(true)} aria-label="Historique et menu" className="grid place-items-center size-9 rounded-lg bg-soft border border-line">
            <Icon name="menu" className="text-[20px]" />
          </button>
        </header>

        <main className="flex-1 min-h-0 flex flex-col">{children}</main>

        {/* Navigation basse (mobile) */}
        <nav className="md:hidden glass border-t border-[var(--hairline)] h-16 shrink-0 flex items-stretch px-2 pb-[env(safe-area-inset-bottom)]">
          {TABS_LEFT.map(tab)}
          <div className="flex-1 flex flex-col items-center">
            <Link
              href="/chat"
              onClick={newChat}
              aria-label="Nouvelle analyse"
              className="-mt-5 grid place-items-center size-[54px] rounded-2xl bg-gradient-to-br from-accent-strong via-accent to-cyan text-white pulse-glow shine"
            >
              <Icon name="auto_awesome" filled className="text-[26px]" />
            </Link>
            <span className={`mt-0.5 text-[10px] font-bold tracking-[0.08em] ${analyzing ? "text-accent-text" : "text-muted"}`}>ANALYSER</span>
          </div>
          {TABS_RIGHT.map(tab)}
        </nav>
      </div>
    </div>
  );
}
