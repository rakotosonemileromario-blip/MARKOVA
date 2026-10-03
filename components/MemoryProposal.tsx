"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getCurrentProjectId } from "@/lib/project-client";

export type Proposal = { categorie: string; competence: string | null; contenu: string };

const CATEGORIES = ["projet", "objectif", "regle", "seuil", "preference", "decision", "apprentissage"];

/**
 * Sépare la réponse de l'agent de ses blocs spéciaux (y compris un bloc encore en cours de streaming) :
 * ```memoire (propositions à enregistrer) et ```vocal (résumé lu à voix haute, masqué à l'écran).
 */
export function splitProposals(content: string): { text: string; proposals: Proposal[]; vocal: string | null } {
  const proposals: Proposal[] = [];
  let vocal: string | null = null;
  let text = content.replace(/```vocal\s*\n([\s\S]*?)```/g, (_, body: string) => {
    vocal = body.trim() || null;
    return "";
  });
  text = text.replace(/```memoire\s*\n([\s\S]*?)```/g, (_, body: string) => {
    for (const line of body.split("\n")) {
      try {
        const p = JSON.parse(line.trim()) as Proposal;
        if (p.contenu && CATEGORIES.includes(p.categorie)) proposals.push(p);
      } catch {
        // ligne non JSON : ignorée
      }
    }
    return "";
  });
  text = text.replace(/```(memoire|vocal)[\s\S]*$/, "");
  return { text: text.trimEnd(), proposals, vocal };
}

export default function MemoryProposal({ proposal }: { proposal: Proposal }) {
  const [state, setState] = useState<"idle" | "saving" | "saved" | "dismissed" | "error">("idle");
  const [content, setContent] = useState(proposal.contenu);

  if (state === "dismissed") return null;

  async function save() {
    setState("saving");
    const supabase = createClient();
    // Mémoire rattachée au projet de la discussion (/c/<id>), pas forcément au projet actif du menu.
    const convId = window.location.pathname.match(/^\/c\/([0-9a-f-]{36})/)?.[1];
    const { data: conv } = convId ? await supabase.from("conversations").select("project_id").eq("id", convId).maybeSingle() : { data: null };
    const { error } = await supabase
      .from("memories")
      .insert({ category: proposal.categorie, skill: proposal.competence, content: content.trim(), project_id: conv ? conv.project_id : getCurrentProjectId() });
    setState(error ? "error" : "saved");
  }

  return (
    <div className="mt-3 rounded-xl border border-accent/40 bg-accent-soft p-3 text-sm">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="font-medium">🧠 Enregistrer en mémoire ?</span>
        <span className="text-xs text-muted">
          {proposal.categorie}
          {proposal.competence ? ` · ${proposal.competence}` : ""}
        </span>
      </div>
      {state === "saved" ? (
        <p>
          {content} <span className="text-ok font-medium">— enregistré ✓</span>
        </p>
      ) : (
        <>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={2}
            className="w-full rounded-lg border border-line bg-panel px-2.5 py-1.5 outline-none focus:border-accent resize-y"
          />
          <div className="mt-2 flex gap-2">
            <button
              onClick={save}
              disabled={state === "saving" || !content.trim()}
              className="rounded-lg bg-accent text-accent-ink px-3 py-1.5 font-medium disabled:opacity-60"
            >
              {state === "saving" ? "…" : "Enregistrer"}
            </button>
            <button onClick={() => setState("dismissed")} className="rounded-lg px-3 py-1.5 hover:bg-soft">
              Ignorer
            </button>
            {state === "error" && <span className="self-center text-danger">Échec de l'enregistrement.</span>}
          </div>
        </>
      )}
    </div>
  );
}
