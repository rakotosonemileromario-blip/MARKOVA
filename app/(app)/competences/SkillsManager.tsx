"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Icon } from "@/components/ui";

type BaseSkill = {
  id: string;
  name: string;
  description: string;
  source: string;
  keywords: string[];
  always_loaded: boolean;
  prompt: string;
  rules: string;
};

type CustomSkill = {
  id: string;
  name: string;
  description: string;
  keywords: string[];
  always_loaded: boolean;
  active: boolean;
  source_name: string | null;
  prompt?: string;
  created_at: string;
};

const ACCEPT_SKILL = ".txt,.md,.csv,.tsv,.pdf,.docx,.xlsx";

export default function SkillsManager({ base }: { base: BaseSkill[] }) {
  const [tab, setTab] = useState<"liste" | "ajouter">("liste");
  const [custom, setCustom] = useState<CustomSkill[] | null>(null);

  const load = useCallback(async () => {
    const { data } = await createClient()
      .from("custom_skills")
      .select("id, name, description, keywords, always_loaded, active, source_name, prompt, created_at")
      .order("created_at", { ascending: false });
    setCustom(data ?? []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function update(id: string, patch: Partial<CustomSkill>) {
    await createClient().from("custom_skills").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
    load();
  }

  async function remove(s: CustomSkill) {
    if (!confirm(`Supprimer la compétence « ${s.name} » ?`)) return;
    await createClient().from("custom_skills").delete().eq("id", s.id);
    load();
  }

  const tabCls = (t: string) =>
    `flex-1 sm:flex-none rounded-lg px-4 h-9 text-[13px] font-semibold ${tab === t ? "bg-accent-strong text-white" : "text-muted hover:text-ink"}`;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 py-6">
        <h1 className="text-[24px] font-bold tracking-tight">Compétences</h1>
        <p className="text-sm text-muted mt-1">
          MARKOVA choisit lui-même les compétences utiles selon ta demande. Ajoute tes propres méthodes de travail : elles deviennent des compétences.
        </p>

        <div className="mt-5 flex gap-1 rounded-xl bg-panel border border-line p-1">
          <button className={tabCls("liste")} onClick={() => setTab("liste")}>
            Mes compétences ({base.length + (custom?.length ?? 0)})
          </button>
          <button className={tabCls("ajouter")} onClick={() => setTab("ajouter")}>
            <span className="inline-flex items-center gap-1">
              <Icon name="add" className="text-[18px]" /> Ajouter une compétence
            </span>
          </button>
        </div>

        {tab === "ajouter" ? (
          <AddSkill
            onAdded={() => {
              load();
              setTab("liste");
            }}
          />
        ) : (
          <div className="mt-5 space-y-6">
            {custom && custom.length > 0 && (
              <section>
                <h2 className="label-caps text-muted mb-2">Ajoutées par toi</h2>
                <div className="space-y-2.5">
                  {custom.map((s) => (
                    <details key={s.id} className={`card p-4 ${s.active ? "" : "opacity-55"}`}>
                      <summary className="cursor-pointer list-none">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="font-semibold flex items-center gap-1.5">
                              <Icon name="extension" className="text-[18px] text-cyan" /> {s.name}
                            </div>
                            <p className="text-[13px] text-muted mt-0.5">{s.description}</p>
                            {s.source_name && <p className="text-[11px] text-muted mt-0.5">Source : {s.source_name}</p>}
                          </div>
                          <span className="shrink-0 text-[11px] text-muted">
                            {!s.active ? "désactivée" : s.always_loaded ? "toujours active" : "à la demande"}
                          </span>
                        </div>
                      </summary>
                      <div className="mt-3 text-[12px] text-muted">Mots-clés : {s.keywords.join(", ") || "—"}</div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button onClick={() => update(s.id, { active: !s.active })} className="rounded-lg border border-line h-8 px-3 text-[12px] font-semibold">
                          {s.active ? "Désactiver" : "Activer"}
                        </button>
                        <button
                          onClick={() => update(s.id, { always_loaded: !s.always_loaded })}
                          className="rounded-lg border border-line h-8 px-3 text-[12px] font-semibold"
                        >
                          {s.always_loaded ? "Seulement à la demande" : "Toujours active"}
                        </button>
                        <button onClick={() => remove(s)} className="rounded-lg border border-line h-8 px-3 text-[12px] font-semibold text-danger">
                          Supprimer
                        </button>
                      </div>
                      {s.prompt && (
                        <pre className="mt-3 max-h-80 overflow-y-auto whitespace-pre-wrap rounded-lg bg-soft p-3 text-[12px]">{s.prompt}</pre>
                      )}
                    </details>
                  ))}
                </div>
              </section>
            )}

            <section>
              <h2 className="label-caps text-muted mb-2">Compétences de base</h2>
              <div className="space-y-2.5">
                {base.map((s) => (
                  <details key={s.id} className="card p-4">
                    <summary className="cursor-pointer list-none">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-semibold">{s.name}</div>
                          <p className="text-[13px] text-muted mt-0.5">{s.description}</p>
                          <p className="text-[11px] text-muted mt-0.5">Source : {s.source}</p>
                        </div>
                        <span className="shrink-0 text-[11px] text-muted">{s.always_loaded ? "toujours active" : "à la demande"}</span>
                      </div>
                    </summary>
                    <div className="mt-3 text-[12px] text-muted">Mots-clés : {s.keywords.join(", ")}</div>
                    {s.rules && <pre className="mt-3 whitespace-pre-wrap rounded-lg bg-soft p-3 text-[12px]">{s.rules}</pre>}
                    <pre className="mt-3 max-h-80 overflow-y-auto whitespace-pre-wrap rounded-lg bg-soft p-3 text-[12px]">{s.prompt}</pre>
                  </details>
                ))}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

function AddSkill({ onAdded }: { onAdded: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [always, setAlways] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file && text.trim().length < 30) return setError("Ajoute un fichier ou colle au moins quelques lignes de texte.");
    setBusy(true);
    setError(null);
    const form = new FormData();
    if (file) form.append("file", file);
    if (text.trim()) form.append("text", text.trim());
    if (name.trim()) form.append("name", name.trim());
    form.append("always_loaded", String(always));
    try {
      const res = await fetch("/api/skills/import", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `Erreur ${res.status}`);
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-5 space-y-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]);
        }}
        onClick={() => input.current?.click()}
        className={`cursor-pointer rounded-xl border-2 border-dashed px-4 py-7 text-center ${drag ? "border-accent bg-accent-soft" : "border-line bg-panel hover:border-accent"}`}
      >
        <Icon name="upload_file" className="text-[30px] text-accent-text" />
        <div className="mt-1 font-semibold">{file ? file.name : "Déposer un fichier"}</div>
        <div className="text-[12px] text-muted mt-0.5">TXT, MD, CSV, PDF, Word (.docx), Excel (.xlsx)</div>
        <input ref={input} type="file" accept={ACCEPT_SKILL} hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </div>
      {file && (
        <button type="button" onClick={() => setFile(null)} className="text-[12px] text-muted underline">
          Retirer le fichier
        </button>
      )}

      <div>
        <label className="label-caps text-muted block mb-1.5">…ou colle le texte de la compétence</label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          placeholder="Ex. : Tu es spécialiste Email Marketing. Ton rôle est de…"
          className="w-full rounded-lg border border-line bg-soft px-3 py-2.5 text-[14px] outline-none focus:border-accent resize-y"
        />
      </div>

      <div>
        <label className="label-caps text-muted block mb-1.5">Nom (optionnel)</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Déduit automatiquement si vide"
          className="w-full h-10 rounded-lg border border-line bg-soft px-3 text-[14px] outline-none focus:border-accent"
        />
      </div>

      <label className="flex items-start gap-2.5 text-[13px] cursor-pointer">
        <input type="checkbox" checked={always} onChange={(e) => setAlways(e.target.checked)} className="mt-0.5 accent-[var(--accent)]" />
        <span>
          <strong>Toujours active</strong>
          <span className="block text-muted">Sinon, MARKOVA la charge seulement quand ta demande correspond (plus rapide).</span>
        </span>
      </label>

      {error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">{error}</p>}

      <button disabled={busy} className="w-full h-11 rounded-lg bg-accent-strong text-white font-semibold glow disabled:opacity-60">
        {busy ? "Lecture et analyse de la compétence…" : "Ajouter la compétence"}
      </button>
      <p className="text-[12px] text-muted">
        MARKOVA lit le document, en déduit le nom, la description et les mots-clés qui déclenchent la compétence. Tu peux ensuite l'activer, la désactiver ou la supprimer.
      </p>
    </form>
  );
}
