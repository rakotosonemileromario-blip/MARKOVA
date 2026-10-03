"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getCurrentProjectId, setCurrentProjectId } from "@/lib/project-client";
import { Icon } from "@/components/ui";

type Project = { id: string; name: string; description: string | null; parent_id: string | null; related_ids: string[]; updated_at: string };
type Counts = Record<string, { convs: number; files: number; mems: number }>;

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [counts, setCounts] = useState<Counts>({});
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [voices, setVoices] = useState<Record<string, string> | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const [p, c, f, m] = await Promise.all([
      supabase.from("projects").select("id, name, description, parent_id, related_ids, updated_at").order("name"),
      supabase.from("conversations").select("project_id"),
      supabase.from("files").select("project_id"),
      supabase.from("memories").select("project_id"),
    ]);
    const next: Counts = {};
    const bump = (rows: { project_id: string | null }[] | null, key: "convs" | "files" | "mems") => {
      for (const r of rows ?? []) {
        if (!r.project_id) continue;
        next[r.project_id] ??= { convs: 0, files: 0, mems: 0 };
        next[r.project_id][key]++;
      }
    };
    bump(c.data, "convs");
    bump(f.data, "files");
    bump(m.data, "mems");
    setCounts(next);
    setProjects(p.data ?? []);
    // Voix de marque lue à part : la colonne n'existe qu'après la mise à jour du schéma (null = pas encore).
    const v = await supabase.from("projects").select("id, brand_voice");
    setVoices(v.error ? null : Object.fromEntries((v.data ?? []).map((r) => [r.id as string, (r.brand_voice as string | null) ?? ""])));
    setCurrentId(getCurrentProjectId());
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = norm(query.trim());
    if (!projects) return [];
    return q ? projects.filter((p) => norm(`${p.name} ${p.description ?? ""}`).includes(q)) : projects;
  }, [projects, query]);

  function open(id: string | null) {
    setCurrentProjectId(id);
    window.location.href = "/";
  }

  async function remove(p: Project) {
    if (!confirm(`Supprimer le projet « ${p.name} » ?\nSes conversations, fichiers et mémoires sont conservés et passent dans « Général ».`)) return;
    const supabase = createClient();
    for (const other of projects ?? []) {
      if (other.related_ids.includes(p.id)) {
        await supabase.from("projects").update({ related_ids: other.related_ids.filter((x) => x !== p.id) }).eq("id", other.id);
      }
    }
    await supabase.from("projects").delete().eq("id", p.id);
    if (currentId === p.id) setCurrentProjectId(null);
    load();
  }

  const relationText = (p: Project) => {
    const all = projects ?? [];
    const parts: string[] = [];
    const parent = all.find((x) => x.id === p.parent_id);
    if (parent) parts.push(`dans ${parent.name}`);
    const children = all.filter((x) => x.parent_id === p.id);
    if (children.length) parts.push(`contient ${children.map((c) => c.name).join(", ")}`);
    const related = all.filter((x) => p.related_ids.includes(x.id) || x.related_ids.includes(p.id));
    if (related.length) parts.push(`complémentaire de ${related.map((r) => r.name).join(", ")}`);
    return parts.join(" · ");
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 py-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-[24px] font-bold tracking-tight">Projets</h1>
            <p className="text-[13px] text-muted mt-0.5">Chaque projet a sa mémoire, ses fichiers et ses conversations.</p>
          </div>
          <button
            onClick={() => setEditing("new")}
            className="shrink-0 rounded-lg bg-accent-strong text-white h-10 px-3.5 inline-flex items-center gap-1.5 text-[13px] font-semibold glow"
          >
            <Icon name="add" className="text-[18px]" /> Nouveau
          </button>
        </div>

        <div className="mt-4 flex items-center gap-2 rounded-xl bg-soft border border-line px-3 h-11 focus-within:border-accent">
          <Icon name="search" className="text-[20px] text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher un projet, un client…"
            className="flex-1 bg-transparent outline-none text-[15px] placeholder:text-muted"
          />
          {query && (
            <button onClick={() => setQuery("")} aria-label="Effacer">
              <Icon name="close" className="text-[18px] text-muted" />
            </button>
          )}
        </div>

        {editing === "new" && (
          <ProjectForm projects={projects ?? []} onDone={(id) => { setEditing(null); if (id) open(id); else load(); }} />
        )}

        <div className="mt-4 space-y-2.5">
          {/* Espace général */}
          <div className={`card p-3.5 flex items-center gap-3 ${!currentId ? "border-accent/60" : ""}`}>
            <span className="grid place-items-center size-10 rounded-lg bg-soft border border-line shrink-0">
              <Icon name="public" className="text-[20px] text-muted" />
            </span>
            <div className="flex-1 min-w-0">
              <div className="font-semibold">Général</div>
              <div className="text-[12px] text-muted">Mémoire commune à tous les projets (préférences, règles globales)</div>
            </div>
            {!currentId ? (
              <span className="tag bg-cyan-soft text-cyan !mr-0">Actif</span>
            ) : (
              <button onClick={() => open(null)} className="rounded-lg border border-line h-9 px-3 text-[13px] font-semibold">
                Ouvrir
              </button>
            )}
          </div>

          {projects === null && <p className="text-[13px] text-muted px-1">Chargement…</p>}
          {projects?.length === 0 && (
            <p className="text-[13px] text-muted px-1">
              Aucun projet. Crée-en un avec « Nouveau », ou dis à MARKOVA : « Crée le projet Business 180 ».
            </p>
          )}
          {projects && projects.length > 0 && filtered.length === 0 && <p className="text-[13px] text-muted px-1">Aucun projet ne correspond.</p>}

          {filtered.map((p) => {
            const c = counts[p.id] ?? { convs: 0, files: 0, mems: 0 };
            const active = p.id === currentId;
            const rel = relationText(p);
            return (
              <div key={p.id} className={`card p-3.5 ${active ? "border-accent/60 bg-gradient-to-br from-soft to-panel" : ""}`}>
                {editing === p.id ? (
                  <ProjectForm project={p} projects={projects ?? []} voice={voices ? (voices[p.id] ?? "") : null} onDone={() => { setEditing(null); load(); }} />
                ) : (
                  <>
                    <div className="flex items-start gap-3">
                      <span className="grid place-items-center size-10 rounded-lg bg-accent-strong text-white font-bold shrink-0">
                        {p.name.slice(0, 1).toUpperCase()}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-[16px] truncate">{p.name}</div>
                        {p.description && <div className="text-[12px] text-muted truncate">{p.description}</div>}
                        {rel && <div className="text-[12px] text-cyan mt-0.5">{rel}</div>}
                      </div>
                      {active && <span className="tag bg-cyan-soft text-cyan !mr-0">Actif</span>}
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
                      <span>{c.convs} conversations</span>
                      <span>{c.files} fichiers</span>
                      <span>{c.mems} mémoires</span>
                      {voices?.[p.id] && <span className="text-cyan">🎙️ voix de marque</span>}
                    </div>
                    <div className="mt-3 flex gap-2">
                      {!active && (
                        <button onClick={() => open(p.id)} className="flex-1 rounded-lg bg-accent-strong text-white h-9 text-[13px] font-semibold inline-flex items-center justify-center gap-1">
                          Ouvrir <Icon name="arrow_forward" className="text-[17px]" />
                        </button>
                      )}
                      <button onClick={() => setEditing(p.id)} className={`${active ? "flex-1" : ""} rounded-lg border border-line h-9 px-3 text-[13px] font-semibold`}>
                        Modifier
                      </button>
                      <button onClick={() => remove(p)} className="rounded-lg border border-line h-9 px-3 text-danger" aria-label="Supprimer">
                        <Icon name="delete" className="text-[18px]" />
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>

        <p className="mt-6 text-[12px] text-muted">
          Astuce : dis simplement à MARKOVA « Lumio et Business 180 sont complémentaires » ou « Lumio est dans cFocus » pour lier des projets.
        </p>
      </div>
    </div>
  );
}

function ProjectForm({
  project,
  projects,
  voice = null,
  onDone,
}: {
  project?: Project;
  projects: Project[];
  voice?: string | null;
  onDone: (createdId?: string) => void;
}) {
  const [name, setName] = useState(project?.name ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [parent, setParent] = useState(project?.parent_id ?? "");
  const [brandVoice, setBrandVoice] = useState(voice ?? "");
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    const supabase = createClient();
    const values = { name: name.trim(), description: description.trim() || null, parent_id: parent || null, updated_at: new Date().toISOString() };
    if (project) {
      await supabase.from("projects").update(values).eq("id", project.id);
      if (voice !== null && brandVoice.trim() !== voice.trim()) {
        await supabase.from("projects").update({ brand_voice: brandVoice.trim() || null }).eq("id", project.id);
      }
      onDone();
    } else {
      const { data } = await supabase.from("projects").insert(values).select("id").single();
      onDone(data?.id);
    }
  }

  const input = "w-full h-10 rounded-lg border border-line bg-soft px-3 text-[14px] outline-none focus:border-accent";
  return (
    <form onSubmit={save} className={`${project ? "" : "card mt-4 p-4"} space-y-3`}>
      {!project && <div className="font-semibold">Nouveau projet</div>}
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Nom (entreprise, client, marque…)" className={input} />
      <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description courte (secteur, offre…)" className={input} />
      <select value={parent} onChange={(e) => setParent(e.target.value)} className={input}>
        <option value="">Projet indépendant</option>
        {projects
          .filter((p) => p.id !== project?.id)
          .map((p) => (
            <option key={p.id} value={p.id}>
              Dans le projet {p.name}
            </option>
          ))}
      </select>
      {project && voice !== null && (
        <label className="block">
          <span className="text-[12px] font-semibold text-muted">🎙️ Voix de marque (appliquée à tous les contenus de ce projet)</span>
          <textarea
            value={brandVoice}
            onChange={(e) => setBrandVoice(e.target.value)}
            rows={8}
            placeholder={"Ton, tutoiement ou vouvoiement, cible, mots à utiliser / éviter, emojis, exemples…\nOu demande à MARKOVA : « Crée la voix de marque à partir de mes publications »."}
            className="mt-1 w-full rounded-lg border border-line bg-soft px-3 py-2 text-[14px] outline-none focus:border-accent"
          />
        </label>
      )}
      <div className="flex gap-2">
        <button disabled={busy || !name.trim()} className="flex-1 rounded-lg bg-accent-strong text-white h-10 text-[13px] font-semibold disabled:opacity-50">
          {project ? "Enregistrer" : "Créer et ouvrir"}
        </button>
        <button type="button" onClick={() => onDone()} className="rounded-lg border border-line h-10 px-4 text-[13px] font-semibold">
          Annuler
        </button>
      </div>
    </form>
  );
}
