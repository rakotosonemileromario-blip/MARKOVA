"use client";

import Link from "next/link";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { setCurrentProjectId } from "@/lib/project-client";
import { Icon } from "./ui";

type P = { id: string; name: string };

const TONES = ["#60a5fa", "#facc15", "#4ade80", "#fb7185", "#c084fc"];

/** Sélection du projet en un geste : pastilles défilantes, projet actif en premier et mis en valeur. */
export default function ProjectChips({ projects, currentId }: { projects: P[]; currentId: string | null }) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

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

  // Projet actif d'abord, puis les autres.
  const list: (P | null)[] = [null, ...projects];
  const ordered = [...list].sort((a, b) => Number((b?.id ?? null) === currentId) - Number((a?.id ?? null) === currentId));

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h2 className="label-caps text-muted flex items-center gap-1.5">
          <Icon name="folder_special" className="text-[16px] text-[#c084fc]" /> Projets
        </h2>
        <Link href="/projets" className="text-[12px] font-semibold text-accent-text">
          Tout voir ({projects.length}) →
        </Link>
      </div>
      <div className="-mx-4 px-4 flex gap-2 overflow-x-auto pb-1 snap-x [scrollbar-width:none]">
        {ordered.map((p, i) => {
          const active = (p?.id ?? null) === currentId;
          const tone = TONES[i % TONES.length];
          return (
            <button
              key={p?.id ?? "general"}
              onClick={() => !active && choose(p?.id ?? null)}
              className="snap-start shrink-0 rounded-2xl border px-3.5 h-11 inline-flex items-center gap-2 text-[14px] font-semibold transition-colors max-w-[70vw]"
              style={
                active
                  ? { borderColor: tone, background: `${tone}26`, color: tone, boxShadow: `0 0 18px -6px ${tone}` }
                  : { borderColor: "var(--line)", background: "var(--soft)", color: "var(--ink)" }
              }
            >
              <Icon name={p ? "folder" : "public"} filled={active} className="text-[18px]" style={{ color: tone }} />
              <span className="truncate">{p?.name ?? "Général"}</span>
              {active && <Icon name="check_circle" filled className="text-[16px]" />}
            </button>
          );
        })}
        {creating ? (
          <form onSubmit={create} className="shrink-0 flex gap-1.5">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => !name.trim() && setCreating(false)}
              placeholder="Nom du projet"
              className="w-40 rounded-2xl bg-soft border border-accent px-3 h-11 text-[14px] outline-none"
            />
            <button className="rounded-2xl bg-accent-strong text-white px-3.5 h-11 text-[13px] font-semibold">Créer</button>
          </form>
        ) : (
          <button
            onClick={() => setCreating(true)}
            className="shrink-0 rounded-2xl border border-dashed border-line px-3.5 h-11 inline-flex items-center gap-1.5 text-[14px] text-muted hover:text-ink"
          >
            <Icon name="add" className="text-[18px]" /> Nouveau
          </button>
        )}
      </div>
    </section>
  );
}
