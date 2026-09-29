import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToolSet } from "./llm";
import { describeRule, METRICS, PERIODS, type WatchRule } from "./monitor";

// Outils de l'agent pour gérer les règles de surveillance (« préviens-moi si le CPL dépasse 12 € »).
// Ce sont des réglages internes : aucune validation nécessaire, rien n'est modifié chez Meta ou Google.

export const WATCH_TOOLS: ToolSet["defs"] = [
  {
    name: "surveillance_creer",
    label: "👁️ Règle de surveillance",
    description:
      "Crée une règle de surveillance vérifiée automatiquement chaque jour sur les campagnes Meta actives ; une notification est envoyée si elle est enfreinte. " +
      "Ex. « préviens-moi si le CPL dépasse 12 € » → metrique cpl, operateur >, seuil 12.",
    parameters: {
      type: "object",
      properties: {
        metrique: { type: "string", enum: Object.keys(METRICS) },
        operateur: { type: "string", enum: [">", "<"], description: "> : alerte si au-dessus ; < : alerte si en dessous" },
        seuil: { type: "number", description: "Valeur du seuil (devise du compte, % pour le CTR, multiple pour le ROAS)" },
        periode: { type: "string", enum: Object.keys(PERIODS), description: "Fenêtre analysée. Défaut last_7d." },
        campagnes: { type: "string", description: "Optionnel : texte contenu dans le nom des campagnes visées. Vide = toutes." },
      },
      required: ["metrique", "operateur", "seuil"],
    },
  },
  {
    name: "surveillance_lister",
    label: "👁️ Règles de surveillance",
    description: "Liste les règles de surveillance (avec leur id).",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "surveillance_supprimer",
    label: "👁️ Suppression d'une règle",
    description: "Supprime une règle de surveillance à partir de son id (obtenu via surveillance_lister).",
    parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
];

export async function listWatchRules(supabase: SupabaseClient) {
  const { data } = await supabase.from("watch_rules").select("*").eq("active", true).order("created_at");
  return (data ?? []) as WatchRule[];
}

/** Renvoie null si l'outil n'est pas un outil de surveillance. */
export async function runWatchTool(supabase: SupabaseClient, name: string, args: Record<string, unknown>): Promise<string | null> {
  if (name === "surveillance_lister") {
    const rules = await listWatchRules(supabase);
    return rules.length ? rules.map((r) => `- id=${r.id} · ${describeRule(r)}`).join("\n") : "Aucune règle de surveillance.";
  }
  if (name === "surveillance_supprimer") {
    const { data, error } = await supabase.from("watch_rules").delete().eq("id", String(args.id ?? "")).select("id");
    if (error) return `Erreur : ${error.message}`;
    return data?.length ? "Règle supprimée." : "Règle introuvable : vérifie l'id avec surveillance_lister.";
  }
  if (name !== "surveillance_creer") return null;

  const metric = String(args.metrique ?? "").toLowerCase();
  const operator = String(args.operateur ?? "");
  const threshold = Number(args.seuil);
  const period = PERIODS[String(args.periode)] ? String(args.periode) : "last_7d";
  const scope = typeof args.campagnes === "string" && args.campagnes.trim() ? args.campagnes.trim() : null;
  if (!METRICS[metric]) return `Métrique inconnue : ${metric}. Choix : ${Object.keys(METRICS).join(", ")}.`;
  if (operator !== ">" && operator !== "<") return "Opérateur invalide : > ou <.";
  if (!Number.isFinite(threshold)) return "Seuil invalide.";

  const rule = { metric, operator: operator as ">" | "<", threshold, period, scope };
  const { error } = await supabase.from("watch_rules").insert({ ...rule, label: describeRule(rule) });
  if (error) return `Erreur : ${error.message}`;
  return `Règle créée : ${describeRule(rule)}. Vérifiée automatiquement chaque jour ; notification en cas de dépassement (page « Alertes »).`;
}
