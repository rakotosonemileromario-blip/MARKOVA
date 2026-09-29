import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToolSet } from "./llm";
import { describeRule, METRICS, PERIODS, SOURCES, type Source, type WatchRule } from "./watch-rules";

// Outils de l'agent pour gérer les règles de surveillance (« préviens-moi si le CPL dépasse 12 € »,
// « alerte-moi si une publication dépasse 100 commentaires »). Ce sont des réglages internes :
// aucune validation nécessaire, rien n'est modifié chez Meta ou Google.

export const WATCH_TOOLS: ToolSet["defs"] = [
  {
    name: "surveillance_creer",
    label: "👁️ Règle de surveillance",
    description:
      "Crée une ou plusieurs règles de surveillance vérifiées automatiquement chaque jour ; une notification est envoyée si elles sont enfreintes. " +
      "source « ads » (campagnes Meta actives) : cpl, cpa, cpc, cpm, ctr, roas, frequence, depenses, leads, clics, impressions. " +
      "source « facebook » ou « instagram » (publications) : likes, commentaires, partages (Facebook), vues, publications (nombre de publications sur la période). " +
      "Ex. « préviens-moi si le CPL dépasse 12 € » → source ads, metriques [cpl], operateur >, seuil 12 ; « alerte-moi si un post Jokenay dépasse 100 commentaires » → source facebook, metriques [commentaires], mode publication, cibles [Jokenay].",
    parameters: {
      type: "object",
      properties: {
        source: { type: "string", enum: Object.keys(SOURCES), description: "Défaut : ads" },
        metriques: { type: "array", items: { type: "string", enum: Object.keys(METRICS) }, description: "Une ou plusieurs métriques (même seuil)" },
        operateur: { type: "string", enum: [">", "<"], description: "> : alerte si au-dessus ; < : alerte si en dessous" },
        seuil: { type: "number", description: "Devise du compte pour les coûts, % pour le CTR, multiple pour le ROAS, nombre sinon" },
        periode: { type: "string", enum: Object.keys(PERIODS), description: "Fenêtre analysée. Défaut last_7d." },
        mode: { type: "string", enum: ["total", "publication"], description: "Réseaux sociaux : total sur la période (défaut) ou chaque publication séparément" },
        cibles: { type: "array", items: { type: "string" }, description: "Noms des campagnes (texte contenu), pages ou comptes visés. Vide = tous." },
      },
      required: ["metriques", "operateur", "seuil"],
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

export type NewRule = { source: Source; metric: string; operator: ">" | "<"; threshold: number; period: string; scope: string | null; aggregation: "total" | "publication" };

/** Vérifie une règle ; renvoie un message d'erreur ou null. */
export function validateRule(r: NewRule): string | null {
  const m = METRICS[r.metric];
  if (!m) return `Métrique inconnue : ${r.metric}. Choix : ${Object.keys(METRICS).join(", ")}.`;
  if (!m.sources.includes(r.source)) return `${m.label} n'existe pas pour ${SOURCES[r.source].label}.`;
  if (r.operator !== ">" && r.operator !== "<") return "Opérateur invalide : > ou <.";
  if (!Number.isFinite(r.threshold)) return "Seuil invalide.";
  if (!PERIODS[r.period]) return "Période invalide.";
  return null;
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

  const source = (["ads", "facebook", "instagram"].includes(String(args.source)) ? args.source : "ads") as Source;
  const metrics = (Array.isArray(args.metriques) ? args.metriques : [args.metriques ?? args.metrique]).map((x) => String(x ?? "").toLowerCase()).filter(Boolean);
  const targets = (Array.isArray(args.cibles) ? args.cibles : typeof args.campagnes === "string" ? [args.campagnes] : []).map(String).map((x) => x.trim()).filter(Boolean);
  const rules: NewRule[] = metrics.map((metric) => ({
    source,
    metric,
    operator: String(args.operateur) as ">" | "<",
    threshold: Number(args.seuil),
    period: PERIODS[String(args.periode)] ? String(args.periode) : "last_7d",
    scope: targets.length ? targets.join(" | ") : null,
    aggregation: args.mode === "publication" ? "publication" : "total",
  }));
  if (!rules.length) return "Indique au moins une métrique.";
  for (const r of rules) {
    const err = validateRule(r);
    if (err) return err;
  }
  const { error } = await supabase.from("watch_rules").insert(rules.map((r) => ({ ...r, label: describeRule(r) })));
  if (error) return `Erreur : ${error.message}`;
  return `${rules.length} règle(s) créée(s) :\n${rules.map((r) => `- ${describeRule(r)}`).join("\n")}\nVérifiées automatiquement chaque jour ; notification en cas de dépassement (page « Alertes »).`;
}
