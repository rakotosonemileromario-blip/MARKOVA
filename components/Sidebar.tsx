"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Brand, Icon } from "./ui";
import ProjectSwitcher from "./ProjectSwitcher";
import { getCurrentProjectId, PROJECT_EVENT } from "@/lib/project-client";
import { UnreadBadge, useUnreadCount } from "./NotificationBell";
import { useTones } from "@/lib/tones";

type Conv = { id: string; title: string; updated_at: string };

export const REFRESH_EVENT = "markova:conversations";
export const NEW_CHAT_EVENT = "markova:new-chat";

/** L'essentiel, toujours visible : 4 entrées seulement. */
export const MAIN_NAV = [
  { href: "/", label: "Discuter avec Kimia", icon: "forum" },
  { href: "/projet", label: "Mon projet", icon: "folder_open" },
  { href: "/notifications", label: "Alertes", icon: "notifications" },
  { href: "/connexions", label: "Mes connexions", icon: "hub" },
];

/** Outils, regroupés en dessous. */
export const MORE_NAV = [
  { href: "/projets", label: "Tous mes projets", icon: "folder_special" },
  { href: "/marche", label: "Étude de marché", icon: "travel_explore" },
  { href: "/veille", label: "Veille des concurrents", icon: "radar" },
  { href: "/memoire", label: "Ce que Kimia retient", icon: "psychology" },
  { href: "/fichiers", label: "Tous mes fichiers", icon: "description" },
  { href: "/competences", label: "Compétences de Kimia", icon: "extension" },
  { href: "/parametres", label: "Paramètres", icon: "settings" },
];

export function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/" || pathname === "/chat" || pathname.startsWith("/c/");
  if (href === "/projet") return pathname === "/projet";
  if (href === "/projets") return pathname === "/projets";
  return pathname.startsWith(href);
}

export function newChat() {
  window.dispatchEvent(new Event(NEW_CHAT_EVENT));
}

const day = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
};

export default function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const [convs, setConvs] = useState<Conv[]>([]);
  const [projectName, setProjectName] = useState<string | null>(null);
  const [userName, setUserName] = useState("");
  const unread = useUnreadCount();
  const tones = useTones([...MAIN_NAV, ...MORE_NAV].map((n) => n.href));

  // Discussions du projet actif uniquement.
  const load = useCallback(async () => {
    const supabase = createClient();
    const project = getCurrentProjectId();
    const q = supabase.from("conversations").select("id, title, updated_at").order("updated_at", { ascending: false }).limit(40);
    const [{ data }, { data: p }] = await Promise.all([
      project ? q.eq("project_id", project) : q.is("project_id", null),
      project ? supabase.from("projects").select("name").eq("id", project).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    setConvs(data ?? []);
    setProjectName(p?.name ?? null);
  }, []);

  useEffect(() => {
    load();
    createClient()
      .auth.getUser()
      .then(({ data }) => setUserName(String(data.user?.user_metadata?.name ?? data.user?.email?.split("@")[0] ?? "")));
    window.addEventListener(REFRESH_EVENT, load);
    window.addEventListener(PROJECT_EVENT, load);
    return () => {
      window.removeEventListener(REFRESH_EVENT, load);
      window.removeEventListener(PROJECT_EVENT, load);
    };
  }, [load]);

  useEffect(onClose, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  async function remove(id: string) {
    if (!confirm("Supprimer cette discussion ?")) return;
    await createClient().from("conversations").delete().eq("id", id);
    if (pathname === `/c/${id}`) window.location.href = "/";
    else load();
  }

  async function logout() {
    await createClient().auth.signOut();
    window.location.href = "/login";
  }

  const navItem = (n: { href: string; label: string; icon: string }, big: boolean) => {
    const active = isActive(pathname, n.href);
    const tone = tones[n.href];
    return (
      <Link
        key={n.href}
        href={n.href}
        onClick={n.href === "/" ? newChat : undefined}
        style={active ? { background: tone.soft } : undefined}
        className={`relative flex items-center gap-3 rounded-xl px-3 transition-colors ${big ? "h-11 text-[15px]" : "h-9 text-[14px]"} ${
          active ? "text-ink font-semibold" : "text-ink/80 hover:bg-soft hover:text-ink"
        }`}
      >
        {active && <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full" style={{ background: tone.fg, boxShadow: `0 0 10px ${tone.fg}` }} />}
        <Icon name={n.icon} filled={active} className={big ? "text-[22px]" : "text-[19px]"} style={{ color: tone.fg }} />
        <span className="flex-1 truncate">{n.label}</span>
        {n.href === "/notifications" && <UnreadBadge count={unread} />}
      </Link>
    );
  };

  return (
    <>
      <div className={`fixed inset-0 bg-black/60 z-40 md:hidden ${open ? "" : "hidden"}`} onClick={onClose} aria-hidden />
      <aside
        className={`fixed md:static z-50 inset-y-0 left-0 w-[290px] max-w-[88vw] shrink-0 bg-panel/95 backdrop-blur-xl border-r border-line flex flex-col transition-transform md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="px-4 pt-5 pb-3 flex items-center justify-between">
          <Brand />
          <button onClick={onClose} className="md:hidden btn btn-ghost btn-sm !px-2" aria-label="Fermer le menu">
            <Icon name="close" className="text-[22px]" />
          </button>
        </div>

        {/* Projet actif + nouvelle discussion : toujours en haut */}
        <div className="px-3 space-y-2">
          <div>
            <div className="px-1 pb-1 text-[12px] font-semibold text-muted">Projet en cours</div>
            <ProjectSwitcher />
          </div>
          <Link href="/" onClick={newChat} className="btn btn-primary w-full">
            <Icon name="edit_square" className="text-[20px]" /> Nouvelle discussion
          </Link>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto mt-3 px-3 pb-3">
          <nav className="space-y-0.5">{MAIN_NAV.map((n) => navItem(n, true))}</nav>

          <div className="mt-4 px-3 pb-1 text-[12px] font-semibold text-muted">Outils</div>
          <nav className="space-y-0.5">{MORE_NAV.map((n) => navItem(n, false))}</nav>

          {/* Historique du projet, avec « Nouvelle discussion » à la fin de la liste */}
          <div className="mt-5 px-3 pb-1.5 flex items-center justify-between">
            <span className="text-[12px] font-semibold text-muted truncate">Discussions · {projectName ?? "Général"}</span>
          </div>
          <div className="space-y-0.5">
            {convs.length === 0 && <p className="px-3 py-1 text-[14px] text-muted">Aucune discussion pour l&apos;instant.</p>}
            {convs.map((c) => (
              <div key={c.id} className={`group flex items-center rounded-xl ${pathname === `/c/${c.id}` ? "bg-soft" : "hover:bg-soft"}`}>
                <Link href={`/c/${c.id}`} className="flex-1 min-w-0 px-3 py-2" title={c.title}>
                  <span className="block truncate text-[14px]">{c.title}</span>
                  <span className="block text-[12px] text-muted">{day(c.updated_at)}</span>
                </Link>
                <button onClick={() => remove(c.id)} className="px-2 text-muted md:opacity-0 group-hover:opacity-100 hover:text-danger" aria-label="Supprimer la discussion">
                  <Icon name="delete" className="text-[18px]" />
                </button>
              </div>
            ))}
            <Link href="/" onClick={newChat} className="mt-1 flex items-center gap-2 rounded-xl border border-dashed border-line px-3 h-10 text-[14px] font-semibold text-accent-text hover:bg-soft">
              <Icon name="add" className="text-[20px]" /> Nouvelle discussion
            </Link>
          </div>
        </div>

        <div className="border-t border-line p-3 flex items-center gap-2">
          <span className="grid place-items-center size-9 rounded-full bg-accent-soft text-accent-text font-bold uppercase shrink-0">{userName.slice(0, 1) || "?"}</span>
          <span className="flex-1 min-w-0 truncate text-[14px] font-semibold">{userName}</span>
          <button onClick={logout} className="btn btn-ghost btn-sm !px-2" title="Se déconnecter" aria-label="Se déconnecter">
            <Icon name="logout" className="text-[20px]" />
          </button>
        </div>
      </aside>
    </>
  );
}
