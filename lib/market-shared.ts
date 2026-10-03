// Constantes des études de marché, partagées entre le serveur (lib/market.ts) et la page « Marché ».

export type Market = { label: string; country: string; region?: string | null; language: string; pages?: string[] };

// Les offres d'abord : le plan de recherche est construit à partir de ce que le projet vend réellement.
export const STEPS = ["offres", "plan", "cibles", "besoins", "pestel", "mots_cles", "sujets", "synthese"] as const;
export type Step = (typeof STEPS)[number];
export const STEP_LABELS: Record<Step, string> = {
  plan: "Préparation",
  offres: "🧾 Offres",
  cibles: "🎯 Cibles",
  besoins: "🧭 Besoins et attentes",
  pestel: "🌍 PESTEL",
  mots_cles: "🔎 Mots-clés",
  sujets: "📅 Sujets et plan de communication",
  synthese: "✨ Synthèse",
};

/** Nom du pays en français (« CA » → « Canada »). */
export function countryName(code: string) {
  try {
    return new Intl.DisplayNames(["fr"], { type: "region" }).of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}
