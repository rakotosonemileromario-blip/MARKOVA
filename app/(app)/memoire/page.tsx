"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getCurrentProjectId } from "@/lib/project-client";
import { Icon } from "@/components/ui";

type Memory = { id: string; category: string; skill: string | null; content: string; active: boolean; project_id: string | null; updated_at: string };
type Project = { id: string; name: string };

const CATEGORIES: { id: string; label: string; hint: string }[] = [
  { id: "projet", label: "🏢 Le projet et ses offres", hint: "Ex. : Business 180 — 3 formules : Je le fais 97 $/mois, L'IA m'aide 197 $/mois…" },
  { id: "objectif", label: "🎯 Objectifs", hint: "Ex. : 30 clients d'ici décembre." },
  { id: "regle", label: "📏 Règles à respecter", hint: "Ex. : Ne jamais modifier une campagne avant 7 jours." },
  { id: "seuil", label: "📊 Seuils (chiffres limites)", hint: "Ex. : Coût par contact maximum 12 $." },
  { id: "preference", label: "⚙️ Mes préférences", hint: "Ex. : Réponses courtes, tutoiement, emojis." },
  { id: "decision", label: "🗂️ Décisions prises", hint: "Ex. : On arrête TikTok pour se concentrer sur Facebook." },
  { id: "apprentissage", label: "💡 Ce qu'on a appris", hint: "Ex. : Les posts avec une question font plus de commentaires." },
];

/** « Ce que Kimia retient » : tout ce que l'utilisateur a demandé de garder, résumé par projet puis par type. */
export default function MemoryPage() {
  const [items, setItems] = useState<Memory[] | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [filter, setFilter] = useState<string>("tous"); // "tous" | "general" | id de projet
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  const load = useCallback(async () => {
    const supabase = createClient();
    const [{ data: mems }, { data: projs }] = await Promise.all([
      supabase.from("memories").select("id, category, skill, content, active, project_id, updated_at").order("created_at"),
      supabase.from("projects").select("id, name").order("name"),
    ]);
    setItems(mems ?? []);
    setProjects(projs ?? []);
  }, []);

  useEffect(() => {
    load();
    const pid = getCurrentProjectId();
    if (pid) setFilter(pid);
  }, [load]);

  async function update(id: string, patch: Partial<Memory>) {
    await createClient().from("memories").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
    load();
  }

  async function remove(id: string) {
    if (!confirm("Kimia doit-elle oublier cet élément ?")) return;
    await createClient().from("memories").delete().eq("id", id);
    load();
  }

  // Groupes : Général puis chaque projet ; dans chaque groupe, par type.
  const groups = useMemo(() => {
    const all = items ?? [];
    const list = [{ id: "general", name: "🌍 Général (tous les projets)" }, ...projects.map((p) => ({ id: p.id, name: `📁 ${p.name}` }))];
    return list
      .filter((g) => filter === "tous" || g.id === filter || (filter !== "general" && g.id === "general"))
      .map((g) => ({ ...g, items: all.filter((m) => (g.id === "general" ? !m.project_id : m.project_id === g.id)) }))
      .filter((g) => g.items.length || g.id === filter);
  }, [items, projects, filter]);

  const total = items?.filter((m) => m.active).length ?? 0;

  // Doublons : même texte, même projet et même type (souvent enregistrés plusieurs fois par erreur).
  const duplicates = useMemo(() => {
    const seen = new Set<string>();
    return (items ?? []).filter((m) => {
      const key = `${m.project_id ?? ""}|${m.category}|${m.content.trim().toLowerCase().replace(/\s+/g, " ")}`;
      if (seen.has(key)) return true;
      seen.add(key);
      return false;
    });
  }, [items]);

  async function removeDuplicates() {
    if (!confirm(`Retirer ${duplicates.length} doublon(s) ? Un exemplaire de chaque information est gardé.`)) return;
    await createClient().from("memories").delete().in("id", duplicates.map((m) => m.id));
    load();
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 py-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="page-title">🧠 Ce que Kimia retient</h1>
            <p className="page-sub">
              {total} information{total > 1 ? "s" : ""} gardée{total > 1 ? "s" : ""}. Kimia les relit avant chaque réponse. Pour en ajouter, dis-lui simplement « mémorise ça ».
            </p>
          </div>
          <button onClick={() => setAdding((x) => !x)} className="btn btn-primary shrink-0">
            <Icon name="add" className="text-[20px]" /> <span className="hidden sm:inline">Ajouter</span>
          </button>
        </div>

        {/* Filtre par projet */}
        <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
          {[{ id: "tous", name: "Tout" }, { id: "general", name: "Général" }, ...projects].map((p) => (
            <button
              key={p.id}
              onClick={() => setFilter(p.id)}
              className={`shrink-0 rounded-full h-9 px-3.5 text-[14px] font-semibold border ${filter === p.id ? "border-accent bg-accent-soft text-ink" : "border-line text-muted"}`}
            >
              {p.name}
            </button>
          ))}
        </div>

        {duplicates.length > 0 && (
          <div className="card mt-4 p-3 flex flex-wrap items-center gap-3 border-warn/40 bg-warn-soft">
            <span className="flex-1 min-w-[200px] text-[15px]">🧹 {duplicates.length} information(s) enregistrée(s) en double.</span>
            <button onClick={removeDuplicates} className="btn btn-sm">Retirer les doublons</button>
          </div>
        )}

        {adding && <AddForm projects={projects} defaultProject={filter !== "tous" && filter !== "general" ? filter : null} onDone={() => { setAdding(false); load(); }} />}

        {items === null && <p className="mt-6 text-muted">Chargement…</p>}
        {items?.length === 0 && (
          <div className="card mt-6 p-5 text-[15px] leading-relaxed">
            Kimia ne retient encore rien. Dans une discussion, décris ton projet (ce que tu vends, à qui, à quel prix), puis dis <b>« mémorise ça »</b> et clique sur <b>Enregistrer</b>.
          </div>
        )}

        {groups.map((g) => (
          <section key={g.id} className="card mt-5 p-4">
            <h2 className="text-[18px] font-bold">{g.name}</h2>
            {g.items.length === 0 && <p className="mt-2 text-[14px] text-muted">Rien pour ce projet.</p>}
            {CATEGORIES.map((c) => {
              const list = g.items.filter((m) => m.category === c.id);
              if (!list.length) return null;
              return (
                <div key={c.id} className="mt-4">
                  <h3 className="text-[14px] font-bold text-muted mb-1.5">{c.label}</h3>
                  <ul className="space-y-1.5">
                    {list.map((m) => (
                      <li key={m.id} className={`rounded-xl bg-soft/60 border border-[var(--hairline)] px-3.5 py-3 ${m.active ? "" : "opacity-50"}`}>
                        {editing === m.id ? (
                          <div>
                            <textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={3} className="field" />
                            <div className="mt-2 flex gap-2">
                              <button onClick={() => { update(m.id, { content: editText.trim() }); setEditing(null); }} className="btn btn-primary btn-sm">
                                Enregistrer
                              </button>
                              <button onClick={() => setEditing(null)} className="btn btn-ghost btn-sm">Annuler</button>
                            </div>
                          </div>
                        ) : (
                          <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{m.content}</p>
                        )}
                        {editing !== m.id && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            <button onClick={() => { setEditing(m.id); setEditText(m.content); }} className="btn btn-ghost btn-sm !h-8">
                              <Icon name="edit" className="text-[17px]" /> Modifier
                            </button>
                            <button onClick={() => update(m.id, { active: !m.active })} className="btn btn-ghost btn-sm !h-8">
                              <Icon name={m.active ? "pause_circle" : "play_circle"} className="text-[17px]" /> {m.active ? "Mettre en pause" : "Réactiver"}
                            </button>
                            <button onClick={() => remove(m.id)} className="btn btn-ghost btn-sm !h-8 !text-danger">
                              <Icon name="delete" className="text-[17px]" /> Oublier
                            </button>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </section>
        ))}
      </div>
    </div>
  );
}

function AddForm({ projects, defaultProject, onDone }: { projects: Project[]; defaultProject: string | null; onDone: () => void }) {
  const [project, setProject] = useState<string>(defaultProject ?? "");
  const [category, setCategory] = useState("projet");
  const [content, setContent] = useState("");

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim()) return;
    await createClient().from("memories").insert({ category, content: content.trim(), project_id: project || null });
    onDone();
  }

  return (
    <form onSubmit={add} className="card mt-4 p-4 space-y-3">
      <div className="font-bold text-[16px]">Ajouter une information</div>
      <div className="grid sm:grid-cols-2 gap-2">
        <select value={project} onChange={(e) => setProject(e.target.value)} className="field" aria-label="Projet">
          <option value="">🌍 Général (tous les projets)</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>📁 {p.name}</option>
          ))}
        </select>
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="field" aria-label="Type">
          {CATEGORIES.map((c) => (
            <option key={c.id} value={c.id}>{c.label}</option>
          ))}
        </select>
      </div>
      <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={3} placeholder={CATEGORIES.find((c) => c.id === category)?.hint} className="field" />
      <div className="flex gap-2">
        <button disabled={!content.trim()} className="btn btn-primary flex-1">Enregistrer</button>
        <button type="button" onClick={onDone} className="btn">Annuler</button>
      </div>
    </form>
  );
}
