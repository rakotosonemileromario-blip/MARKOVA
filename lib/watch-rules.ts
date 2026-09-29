// Définitions des règles de surveillance, partagées entre le serveur et l'interface (aucune dépendance serveur).

export type Source = "ads" | "facebook" | "instagram";
export type Aggregation = "total" | "publication";

export const SOURCES: Record<Source, { label: string; emoji: string }> = {
  ads: { label: "Pubs Meta", emoji: "📢" },
  facebook: { label: "Page Facebook", emoji: "👍" },
  instagram: { label: "Instagram", emoji: "📸" },
};

type Metric = { label: string; unit: "devise" | "%" | "x" | ""; emoji: string; sources: Source[] };

export const METRICS: Record<string, Metric> = {
  // Publicités
  cpl: { label: "CPL", unit: "devise", emoji: "🎯", sources: ["ads"] },
  cpa: { label: "CPA", unit: "devise", emoji: "🛒", sources: ["ads"] },
  cpc: { label: "CPC", unit: "devise", emoji: "🖱️", sources: ["ads"] },
  cpm: { label: "CPM", unit: "devise", emoji: "📣", sources: ["ads"] },
  ctr: { label: "CTR", unit: "%", emoji: "⚡", sources: ["ads"] },
  roas: { label: "ROAS", unit: "x", emoji: "💰", sources: ["ads"] },
  frequence: { label: "Fréquence", unit: "", emoji: "🔁", sources: ["ads"] },
  depenses: { label: "Dépenses", unit: "devise", emoji: "💸", sources: ["ads"] },
  leads: { label: "Leads", unit: "", emoji: "🧲", sources: ["ads"] },
  clics: { label: "Clics", unit: "", emoji: "👆", sources: ["ads"] },
  impressions: { label: "Impressions", unit: "", emoji: "👀", sources: ["ads"] },
  // Réseaux sociaux (organique)
  likes: { label: "Likes / réactions", unit: "", emoji: "❤️", sources: ["facebook", "instagram"] },
  commentaires: { label: "Commentaires", unit: "", emoji: "💬", sources: ["facebook", "instagram"] },
  partages: { label: "Partages", unit: "", emoji: "🔄", sources: ["facebook"] },
  vues: { label: "Vues", unit: "", emoji: "▶️", sources: ["facebook", "instagram"] },
  publications: { label: "Nombre de publications", unit: "", emoji: "📝", sources: ["facebook", "instagram"] },
};

export const PERIODS: Record<string, string> = {
  yesterday: "hier",
  last_3d: "3 derniers jours",
  last_7d: "7 derniers jours",
  last_14d: "14 derniers jours",
  last_30d: "30 derniers jours",
};

export const PERIOD_DAYS: Record<string, number> = { yesterday: 1, last_3d: 3, last_7d: 7, last_14d: 14, last_30d: 30 };

export type WatchRule = {
  id: string; metric: string; operator: ">" | "<"; threshold: number; period: string; scope: string | null; label: string | null; active: boolean;
  source?: Source; aggregation?: Aggregation;
};

/** Plusieurs pages ou campagnes visées : stockées séparées par « | ». */
export const scopeList = (scope: string | null | undefined) => (scope ?? "").split("|").map((x) => x.trim()).filter(Boolean);

export function describeRule(r: Pick<WatchRule, "metric" | "operator" | "threshold" | "period" | "scope" | "source" | "aggregation">, currency = "€") {
  const m = METRICS[r.metric];
  const source = r.source ?? "ads";
  const unit = m?.unit === "devise" ? ` ${currency}` : m?.unit === "%" ? " %" : m?.unit === "x" ? "x" : "";
  const targets = scopeList(r.scope);
  const where =
    source === "ads"
      ? targets.length ? `campagnes « ${targets.join(" », « ")} »` : "toutes les campagnes actives"
      : targets.length ? `${source === "facebook" ? "pages" : "comptes"} ${targets.join(", ")}` : `toutes les ${source === "facebook" ? "pages Facebook" : "comptes Instagram"}`;
  const how = source === "ads" ? "" : r.metric === "publications" ? " (nombre sur la période)" : r.aggregation === "publication" ? " (par publication)" : " (total sur la période)";
  return `${SOURCES[source].emoji} ${m?.label ?? r.metric}${how} ${r.operator === ">" ? "au-dessus de" : "en dessous de"} ${r.threshold}${unit} · ${PERIODS[r.period] ?? r.period} · ${where}`;
}
