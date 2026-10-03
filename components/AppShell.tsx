"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import Sidebar, { isActive, newChat } from "./Sidebar";
import { Icon, LogoMark } from "./ui";
import ProjectSwitcher from "./ProjectSwitcher";
import DeviceSync from "./DeviceSync";
import ScrollReveal from "./ScrollReveal";
import NotificationBell, { UnreadBadge, useUnreadCount } from "./NotificationBell";
import PushPrompt from "./PushPrompt";
import { useTones } from "@/lib/tones";

// Téléphone : 2 onglets à gauche, Kimia au centre, 2 à droite (dont « Menu » qui ouvre tout le reste).
const TABS_LEFT = [
  { href: "/projet", label: "Projet", icon: "folder_open" },
  { href: "/notifications", label: "Alertes", icon: "notifications" },
];
const TABS_RIGHT = [{ href: "/connexions", label: "Connexions", icon: "hub" }];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const chatting = isActive(pathname, "/");
  const unread = useUnreadCount();
  const tones = useTones([...TABS_LEFT, ...TABS_RIGHT, { href: "#menu" }].map((t) => t.href));

  const tab = (t: { href: string; label: string; icon: string }) => {
    const active = isActive(pathname, t.href);
    const tone = tones[t.href];
    return (
      <Link key={t.href} href={t.href} className="relative flex-1 flex flex-col items-center justify-center gap-0.5 text-[12px] font-semibold">
        <span className="grid place-items-center rounded-full px-3.5 h-8 transition-colors" style={{ background: active ? tone.soft : undefined }}>
          <Icon name={t.icon} filled={active} className="text-[24px]" style={{ color: tone.fg }} />
        </span>
        <span className={active ? "text-ink" : "text-muted"}>{t.label}</span>
        {t.href === "/notifications" && unread > 0 && (
          <span className="absolute top-0.5 right-[22%]">
            <UnreadBadge count={unread} />
          </span>
        )}
      </Link>
    );
  };

  return (
    <div className="h-[var(--app-h,100dvh)] flex">
      <DeviceSync />
      <ScrollReveal />
      <PushPrompt />
      <Sidebar open={open} onClose={() => setOpen(false)} />
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Barre du haut (téléphone) : le projet en cours, toujours visible */}
        <header className="md:hidden flex items-center gap-2 border-b border-line glass px-3 h-14 shrink-0 relative z-30">
          <Link href="/" onClick={newChat} aria-label="Accueil" className="grid place-items-center rounded-lg bg-soft border border-line p-1 shrink-0">
            <LogoMark size={26} />
          </Link>
          <div className="flex-1 min-w-0">
            <ProjectSwitcher variant="header" />
          </div>
          <NotificationBell />
        </header>

        <main className="flex-1 min-h-0 flex flex-col">{children}</main>

        {/* Navigation basse (téléphone) */}
        <nav className="md:hidden glass border-t border-[var(--hairline)] h-[68px] shrink-0 flex items-stretch px-1 pb-[env(safe-area-inset-bottom)]">
          {TABS_LEFT.map(tab)}
          <div className="flex-1 flex flex-col items-center">
            <Link
              href="/"
              onClick={newChat}
              aria-label="Discuter avec Kimia"
              className="-mt-5 grid place-items-center size-[58px] rounded-2xl bg-gradient-to-br from-accent-strong via-accent to-cyan text-white pulse-glow shine"
            >
              <Icon name="forum" filled className="text-[28px]" />
            </Link>
            <span className={`mt-0.5 text-[12px] font-bold ${chatting ? "text-accent-text" : "text-muted"}`}>Kimia</span>
          </div>
          {TABS_RIGHT.map(tab)}
          <button onClick={() => setOpen(true)} className="flex-1 flex flex-col items-center justify-center gap-0.5 text-[12px] font-semibold" aria-label="Ouvrir le menu complet">
            <span className="grid place-items-center rounded-full px-3.5 h-8">
              <Icon name="menu" className="text-[24px]" style={{ color: tones["#menu"].fg }} />
            </span>
            <span className="text-muted">Menu</span>
          </button>
        </nav>
      </div>
    </div>
  );
}
