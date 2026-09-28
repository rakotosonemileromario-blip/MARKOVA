"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Brand, Icon } from "./ui";
import ProjectSwitcher from "./ProjectSwitcher";
import { getCurrentProjectId } from "@/lib/project-client";

type Conv = { id: string; title: string; updated_at: string };

export const REFRESH_EVENT = "markova:conversations";
export const NEW_CHAT_EVENT = "markova:new-chat";

export const NAV = [
  { href: "/", label: "Accueil", icon: "space_dashboard" },
  { href: "/projets", label: "Projets", icon: "folder_special" },
  { href: "/chat", label: "Analyser", icon: "auto_awesome" },
  { href: "/fichiers", label: "Fichiers", icon: "folder_open" },
  { href: "/memoire", label: "Mémoire", icon: "memory" },
  { href: "/competences", label: "Compétences", icon: "extension" },
  { href: "/connexions", label: "Connexions", icon: "hub" },
];

export function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  if (href === "/chat") return pathname === "/chat" || pathname.startsWith("/c/");
  return pathname.startsWith(href);
}

export function newChat() {
  window.dispatchEvent(new Event(NEW_CHAT_EVENT));
}

export default function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const [convs, setConvs] = useState<Conv[]>([]);

  // Historique du projet actif uniquement.
  const load = useCallback(async () => {
    const project = getCurrentProjectId();
    const q = createClient().from("conversations").select("id, title, updated_at").order("updated_at", { ascending: false }).limit(50);
    const { data } = await (project ? q.eq("project_id", project) : q.is("project_id", null));
    setConvs(data ?? []);
  }, []);

  useEffect(() => {
    load();
    window.addEventListener(REFRESH_EVENT, load);
    return () => window.removeEventListener(REFRESH_EVENT, load);
  }, [load]);

  useEffect(onClose, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  async function remove(id: string) {
    if (!confirm("Supprimer cette conversation ?")) return;
    await createClient().from("conversations").delete().eq("id", id);
    if (pathname === `/c/${id}`) window.location.href = "/chat";
    else load();
  }

  async function logout() {
    await createClient().auth.signOut();
    window.location.href = "/login";
  }

  return (
    <>
      <div className={`fixed inset-0 bg-black/60 z-40 md:hidden ${open ? "" : "hidden"}`} onClick={onClose} aria-hidden />
      <aside
        className={`fixed md:static z-50 inset-y-0 left-0 w-72 shrink-0 bg-panel/85 backdrop-blur-xl border-r border-line flex flex-col transition-transform md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="px-4 pt-5 pb-4 flex items-center justify-between">
          <Brand />
          <button onClick={onClose} className="md:hidden text-muted p-1" aria-label="Fermer">
            <Icon name="close" />
          </button>
        </div>

        <div className="px-3 mb-2.5">
          <ProjectSwitcher />
        </div>

        <div className="px-3">
          <Link
            href="/chat"
            onClick={newChat}
            className="flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-accent-strong to-accent text-accent-ink h-10 text-[13px] font-semibold pulse-glow shine"
          >
            <Icon name="auto_awesome" className="text-[18px]" />
            Nouvelle analyse
          </Link>
        </div>

        <nav className="px-3 mt-4 space-y-0.5">
          {NAV.filter((n) => n.href !== "/chat").map((n) => {
            const active = isActive(pathname, n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`relative flex items-center gap-3 rounded-lg px-3 h-9 text-[13px] transition-colors ${
                  active ? "bg-accent-soft text-accent-text font-semibold" : "text-muted hover:bg-soft hover:text-ink"
                }`}
              >
                {active && <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-cyan shadow-[0_0_10px_#22d3ee]" />}
                <Icon name={n.icon} className="text-[19px]" filled={active} />
                {n.label}
              </Link>
            );
          })}
        </nav>

        <div className="px-6 mt-6 mb-2 label-caps text-muted">Historique</div>
        <div className="flex-1 overflow-y-auto px-3 pb-3">
          {convs.length === 0 && <p className="px-3 text-[13px] text-muted">Aucune conversation.</p>}
          {convs.map((c) => (
            <div key={c.id} className={`group flex items-center rounded-lg ${pathname === `/c/${c.id}` ? "bg-soft" : "hover:bg-soft"}`}>
              <Link href={`/c/${c.id}`} className="flex-1 truncate px-3 py-2 text-[13px]" title={c.title}>
                {c.title}
              </Link>
              <button
                onClick={() => remove(c.id)}
                className="px-2 text-muted md:opacity-0 group-hover:opacity-100 hover:text-danger"
                aria-label="Supprimer"
              >
                <Icon name="delete" className="text-[17px]" />
              </button>
            </div>
          ))}
        </div>

        <div className="border-t border-line p-3">
          <button onClick={logout} className="w-full flex items-center gap-3 rounded-lg px-3 h-9 text-[13px] text-muted hover:bg-soft">
            <Icon name="logout" className="text-[19px]" />
            Se déconnecter
          </button>
        </div>
      </aside>
    </>
  );
}
