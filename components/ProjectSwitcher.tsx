"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getCurrentProjectId, PROJECT_EVENT, setCurrentProjectId } from "@/lib/project-client";
import { Icon } from "./ui";

type Project = { id: string; name: string; description: string | null; parent_id: string | null; related_ids: string[] };

const normalize = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

function relations(p: Project, all: Project[]) {
  const parts: string[] = [];
  const parent = all.find((x) => x.id === p.parent_id);
  if (parent) parts.push(`dans ${parent.name}`);
  const related = all.filter((x) => p.related_ids.includes(x.id) || x.related_ids.includes(p.id));
  if (related.length) parts.push(`+ ${related.map((r) => r.name).join(", ")}`);
  return parts.join(" · ");
}

/** Menu de choix du projet actif. Changer de projet recharge l'accueil dans le nouveau contexte. */
export default function ProjectSwitcher({ variant = "sidebar" }: { variant?: "sidebar" | "header" | "card" }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [q, setQ] = useState("");
  const box = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const { data } = await createClient().from("projects").select("id, name, description, parent_id, related_ids").order("name");
    setProjects(data ?? []);
    setCurrentId(getCurrentProjectId());
  }, []);

  useEffect(() => {
    load();
    window.addEventListener(PROJECT_EVENT, load);
    return () => window.removeEventListener(PROJECT_EVENT, load);
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  function choose(id: string | null) {
    setCurrentProjectId(id);
    window.location.href = "/";
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const { data } = await createClient().from("projects").insert({ name: name.trim() }).select("id").single();
    if (data) choose(data.id);
  }

  const current = projects.find((p) => p.id === currentId) ?? null;
  const label = current?.name ?? "Général";

  const trigger =
    variant === "card"
      ? "shrink-0 rounded-lg bg-soft border border-line px-2.5 h-8 inline-flex items-center gap-1 text-[12px] font-semibold"
      : variant === "header"
        ? "flex items-center gap-1.5 rounded-lg bg-soft border border-line pl-2.5 pr-1.5 h-9 text-[13px] font-semibold max-w-[55vw]"
        : "w-full flex items-center gap-2 rounded-lg bg-soft border border-line px-3 h-10 text-[13px] font-semibold";

  return (
    <div ref={box} className={`relative ${variant === "sidebar" ? "w-full" : ""}`}>
      <button onClick={() => setOpen((o) => !o)} className={trigger} aria-haspopup="listbox" aria-expanded={open}>
        {variant !== "card" && <span className={`size-2 rounded-full shrink-0 ${current ? "bg-cyan" : "bg-muted"}`} />}
        <span className="truncate flex-1 text-left">{variant === "card" ? "Projet" : label}</span>
        <Icon name="unfold_more" className="text-[16px] text-muted" />
      </button>

      {open && (
        <div
          className={`absolute z-50 mt-1.5 w-72 max-w-[90vw] rounded-xl glass border border-[var(--hairline)] p-1.5 shadow-2xl ${
            variant === "sidebar" ? "left-0" : "right-0"
          }`}
          role="listbox"
        >
          <div className="px-2.5 pt-1.5 pb-1 flex items-center justify-between">
            <span className="label-caps text-muted">Projets ({projects.length})</span>
            <a href="/projets" className="text-[11px] font-semibold text-accent-text">Tout voir →</a>
          </div>
          {projects.length > 4 && (
            <div className="px-1 pb-1">
              <div className="flex items-center gap-1.5 rounded-lg bg-soft border border-line px-2 h-9 focus-within:border-accent">
                <Icon name="search" className="text-[17px] text-muted" />
                <input
                  autoFocus
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Rechercher…"
                  className="flex-1 min-w-0 bg-transparent outline-none text-[13px] placeholder:text-muted"
                />
              </div>
            </div>
          )}
          <div className="max-h-72 overflow-y-auto">
            <button
              onClick={() => choose(null)}
              className={`w-full text-left rounded-lg px-2.5 py-2 hover:bg-soft ${!current ? "bg-accent-soft" : ""}`}
            >
              <div className="text-[13px] font-semibold flex items-center gap-2">
                <Icon name="public" className="text-[16px] text-muted" /> Général
              </div>
              <div className="text-[11px] text-muted pl-6">Mémoire commune à tous les projets</div>
            </button>
            {projects.filter((p) => !q.trim() || normalize(p.name + " " + (p.description ?? "")).includes(normalize(q.trim()))).map((p) => (
              <button
                key={p.id}
                onClick={() => choose(p.id)}
                className={`w-full text-left rounded-lg px-2.5 py-2 hover:bg-soft ${p.id === currentId ? "bg-accent-soft" : ""}`}
              >
                <div className="text-[13px] font-semibold flex items-center gap-2">
                  <Icon name={p.parent_id ? "subdirectory_arrow_right" : "folder"} className="text-[16px] text-accent-text" />
                  <span className="truncate">{p.name}</span>
                  {p.id === currentId && <Icon name="check" className="text-[16px] text-accent-text ml-auto" />}
                </div>
                {(relations(p, projects) || p.description) && (
                  <div className="text-[11px] text-muted pl-6 truncate">{relations(p, projects) || p.description}</div>
                )}
              </button>
            ))}
          </div>
          <div className="border-t border-line mt-1 pt-1">
            {creating ? (
              <form onSubmit={create} className="flex gap-1.5 p-1">
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Nom du projet"
                  className="flex-1 min-w-0 rounded-lg bg-soft border border-line px-2.5 h-9 text-[13px] outline-none focus:border-accent"
                />
                <button className="rounded-lg bg-accent-strong text-white px-3 h-9 text-[12px] font-semibold">Créer</button>
              </form>
            ) : (
              <button onClick={() => setCreating(true)} className="w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-accent-text hover:bg-soft">
                <Icon name="add" className="text-[18px]" /> Nouveau projet
              </button>
            )}
            <p className="px-2.5 pb-1.5 text-[11px] text-muted leading-snug">
              Pour lier des projets, dis-le à Kimia : « A et B sont complémentaires », « A est dans B ».
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
