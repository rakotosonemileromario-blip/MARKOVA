import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToolSet } from "./llm";
import type { Project } from "./projects";

// Voix de marque : une fiche par projet (ton, vocabulaire, cible, exemples), injectée automatiquement
// dans les consignes de l'agent pour tout contenu rédigé. Un sous-projet sans fiche hérite de son parent.

export type BrandVoice = { project: string; text: string; inherited: boolean };

/**
 * Fiche du projet actif, sinon celle du premier parent qui en a une.
 * Lue à part (et sans erreur bloquante) : la colonne n'existe qu'après la mise à jour du schéma.
 */
export async function getBrandVoice(supabase: SupabaseClient, current: Project | null, all: Project[]): Promise<BrandVoice | null> {
  if (!current) return null;
  const { data, error } = await supabase.from("projects").select("id, brand_voice");
  if (error) return null;
  const voices = new Map((data ?? []).map((r) => [r.id as string, (r.brand_voice as string | null)?.trim() ?? ""]));
  let p: Project | undefined = current;
  const seen = new Set<string>();
  while (p && !seen.has(p.id)) {
    seen.add(p.id);
    const text = voices.get(p.id);
    if (text) return { project: p.name, text, inherited: p.id !== current.id };
    p = all.find((x) => x.id === p!.parent_id);
  }
  return null;
}

export const BRAND_TOOLS: ToolSet["defs"] = [
  {
    name: "voix_marque_definir",
    label: "🎙️ Voix de marque",
    description:
      "Enregistre (remplace) la fiche « voix de marque » du projet actif ou d'un projet nommé. Elle sera appliquée automatiquement à tous les contenus de ce projet. " +
      "Rédige une fiche complète et structurée : ## Identité (qui, promesse, valeurs) · ## Cible · ## Ton (3–5 adjectifs + explications) · ## Tutoiement ou vouvoiement · " +
      "## Vocabulaire (mots à utiliser / à éviter) · ## Emojis et ponctuation · ## Formats et longueurs · ## Exemples (2–3 phrases typiques) · ## Interdits. " +
      "Pour modifier une partie, relis la fiche actuelle (voix_marque_lire) et renvoie la fiche entière mise à jour.",
    parameters: {
      type: "object",
      properties: {
        fiche: { type: "string", description: "Fiche complète en markdown" },
        projet: { type: "string", description: "Nom du projet (défaut : projet actif)" },
      },
      required: ["fiche"],
    },
  },
  {
    name: "voix_marque_lire",
    label: "🎙️ Lecture de la voix de marque",
    description: "Lit la fiche « voix de marque » d'un projet (défaut : projet actif).",
    parameters: { type: "object", properties: { projet: { type: "string" } } },
  },
];

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

/** Renvoie null si l'outil n'est pas un outil de voix de marque. */
export async function runBrandTool(
  supabase: SupabaseClient,
  name: string,
  args: Record<string, unknown>,
  ctx: { current: Project | null; all: Project[] },
): Promise<string | null> {
  if (name !== "voix_marque_definir" && name !== "voix_marque_lire") return null;
  const wanted = norm(String(args.projet ?? ""));
  const project = wanted
    ? (ctx.all.find((p) => norm(p.name) === wanted) ?? ctx.all.find((p) => norm(p.name).includes(wanted) || wanted.includes(norm(p.name))))
    : ctx.current;
  if (!project) {
    return wanted
      ? `Projet introuvable. Projets : ${ctx.all.map((p) => p.name).join(", ") || "aucun"}.`
      : "Aucun projet actif : la voix de marque se définit par projet. Demande à l'utilisateur de choisir ou créer le projet (projet_activer / projet_creer), ou passe « projet ».";
  }

  if (name === "voix_marque_lire") {
    const v = await getBrandVoice(supabase, project, ctx.all);
    if (!v) return `Aucune voix de marque pour « ${project.name} ». Propose d'en créer une (par exemple en analysant ses publications récentes).`;
    return `Voix de marque${v.inherited ? ` héritée du projet « ${v.project} »` : ` de « ${project.name} »`} :\n\n${v.text}`;
  }

  const fiche = String(args.fiche ?? "").trim();
  if (fiche.length < 40) return "Fiche trop courte : rédige une fiche complète (ton, cible, vocabulaire, exemples…).";
  const { error } = await supabase.from("projects").update({ brand_voice: fiche.slice(0, 8000), updated_at: new Date().toISOString() }).eq("id", project.id);
  if (error) {
    return /brand_voice/.test(error.message)
      ? "La base n'est pas encore à jour : l'utilisateur doit relancer supabase/schema.sql dans Supabase (SQL Editor)."
      : `Erreur : ${error.message}`;
  }
  return `Voix de marque enregistrée pour « ${project.name} ». Elle s'applique désormais à tous les contenus de ce projet (et de ses sous-projets sans fiche propre).`;
}
