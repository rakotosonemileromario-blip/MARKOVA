"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getCurrentProjectId } from "@/lib/project-client";

type Memory = { id: string; category: string; skill: string | null; content: string; active: boolean; project_id: string | null };

const CATEGORIES: { id: string; label: string; hint: string }[] = [
  { id: "projet", label: "🏢 Projet", hint: "Entreprise, offres, personas, positionnement, marché…" },
  { id: "objectif", label: "🎯 Objectifs", hint: "Objectifs business et marketing mesurables." },
  { id: "regle", label: "📏 Règles", hint: "Ex. : Ne jamais modifier une campagne avant 7 jours." },
  { id: "seuil", label: "📊 Seuils KPI", hint: "Ex. : CPL maximum 12 €." },
  { id: "preference", label: "⚙️ Préférences", hint: "Façon de travailler, format des réponses…" },
  { id: "decision", label: "🗂️ Décisions", hint: "Décisions prises et leur raison." },
  { id: "apprentissage", label: "💡 Apprentissages", hint: "Ce qui a été confirmé par les données." },
];

const SKILLS = [
  { id: "", label: "Toutes compétences" },
  { id: "direction-marketing", label: "Direction Marketing" },
  { id: "calendrier", label: "Calendrier" },
  { id: "contenu", label: "Contenu" },
  { id: "publicites", label: "Publicités" },
  { id: "media-buying", label: "Media Buying" },
];

export default function MemoryPage() {
  const [items, setItems] = useState<Memory[] | null>(null);
  const [category, setCategory] = useState("projet");
  const [skill, setSkill] = useState("");
  const [content, setContent] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [project, setProject] = useState<{ id: string; name: string } | null>(null);
  const [scope, setScope] = useState<"projet" | "general">("projet");

  // Mémoire du projet actif + mémoire générale (commune à tous les projets).
  const load = useCallback(async () => {
    const supabase = createClient();
    const pid = getCurrentProjectId();
    const { data: p } = pid ? await supabase.from("projects").select("id, name").eq("id", pid).maybeSingle() : { data: null };
    setProject(p);
    const q = supabase.from("memories").select("id, category, skill, content, active, project_id").order("created_at");
    const { data } = await (p ? q.or(`project_id.is.null,project_id.eq.${p.id}`) : q.is("project_id", null));
    setItems(data ?? []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim()) return;
    const project_id = project && scope === "projet" ? project.id : null;
    await createClient().from("memories").insert({ category, skill: skill || null, content: content.trim(), project_id });
    setContent("");
    load();
  }

  async function update(id: string, patch: Partial<Memory>) {
    await createClient().from("memories").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
    load();
  }

  async function remove(id: string) {
    if (!confirm("Supprimer cet élément de la mémoire ?")) return;
    await createClient().from("memories").delete().eq("id", id);
    load();
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 py-6">
        <h1 className="text-[24px] font-bold tracking-tight">Mémoire{project ? ` · ${project.name}` : " générale"}</h1>
        <p className="text-sm text-muted mt-1">
          Tout ce qui est actif ici est transmis à MARKOVA à chaque message. Les règles et seuils priment sur les recommandations générales.
          {project && " Les éléments « Général » s'appliquent à tous les projets."}
        </p>

        <form onSubmit={add} className="mt-5 rounded-2xl border border-line bg-panel p-4">
          <div className="flex flex-wrap gap-2">
            {project && (
              <select value={scope} onChange={(e) => setScope(e.target.value as "projet" | "general")} className="rounded-lg border border-line bg-bg px-2 py-1.5 text-sm">
                <option value="projet">Projet {project.name}</option>
                <option value="general">Général (tous les projets)</option>
              </select>
            )}
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded-lg border border-line bg-bg px-2 py-1.5 text-sm">
              {CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
            <select value={skill} onChange={(e) => setSkill(e.target.value)} className="rounded-lg border border-line bg-bg px-2 py-1.5 text-sm">
              {SKILLS.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </div>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={2}
            placeholder={CATEGORIES.find((c) => c.id === category)?.hint}
            className="mt-2 w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent resize-y"
          />
          <button disabled={!content.trim()} className="mt-2 rounded-lg bg-accent text-accent-ink px-4 py-1.5 text-sm font-medium disabled:opacity-40">
            Ajouter
          </button>
        </form>

        {items === null && <p className="mt-6 text-sm text-muted">Chargement…</p>}
        {CATEGORIES.map((c) => {
          const list = items?.filter((m) => m.category === c.id) ?? [];
          if (!list.length) return null;
          return (
            <section key={c.id} className="mt-6">
              <h2 className="text-sm font-semibold mb-2">{c.label}</h2>
              <div className="divide-y divide-line rounded-2xl border border-line bg-panel">
                {list.map((m) => (
                  <div key={m.id} className={`flex items-start gap-3 px-4 py-3 ${m.active ? "" : "opacity-50"}`}>
                    <div className="flex-1 min-w-0 text-sm">
                      {editing === m.id ? (
                        <div>
                          <textarea
                            value={editText}
                            onChange={(e) => setEditText(e.target.value)}
                            rows={2}
                            className="w-full rounded-lg border border-line bg-bg px-2 py-1.5 outline-none focus:border-accent"
                          />
                          <div className="mt-1 flex gap-2">
                            <button
                              onClick={() => { update(m.id, { content: editText.trim() }); setEditing(null); }}
                              className="rounded-lg bg-accent text-accent-ink px-3 py-1 text-xs font-medium"
                            >
                              Enregistrer
                            </button>
                            <button onClick={() => setEditing(null)} className="px-3 py-1 text-xs">Annuler</button>
                          </div>
                        </div>
                      ) : (
                        <p className="whitespace-pre-wrap">{m.content}</p>
                      )}
                      {project && !m.project_id && <span className="mt-1 mr-1 inline-block rounded-full bg-soft px-2 py-0.5 text-[11px] text-muted">Général</span>}
                      {m.skill && <span className="mt-1 inline-block rounded-full bg-soft px-2 py-0.5 text-[11px] text-muted">{m.skill}</span>}
                    </div>
                    <div className="flex shrink-0 gap-1 text-xs">
                      <button onClick={() => { setEditing(m.id); setEditText(m.content); }} className="rounded px-1.5 py-0.5 hover:bg-soft">
                        Modifier
                      </button>
                      <button onClick={() => update(m.id, { active: !m.active })} className="rounded px-1.5 py-0.5 hover:bg-soft">
                        {m.active ? "Désactiver" : "Activer"}
                      </button>
                      <button onClick={() => remove(m.id)} className="rounded px-1.5 py-0.5 text-danger hover:bg-soft">
                        Supprimer
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
        {items?.length === 0 && (
          <p className="mt-6 text-sm text-muted">
            La mémoire est vide. Commence par décrire ton projet (entreprise, offre prioritaire, persona, objectifs) — MARKOVA sera bien plus précis.
          </p>
        )}
      </div>
    </div>
  );
}
