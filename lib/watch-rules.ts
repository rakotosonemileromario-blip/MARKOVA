// Définitions des règles de surveillance, partagées entre le serveur et l'interface (aucune dépendance serveur).

export const METRICS: Record<string, { label: string; unit: "devise" | "%" | "x" | "" }> = {
  cpl: { label: "CPL", unit: "devise" },
  cpa: { label: "CPA", unit: "devise" },
  cpc: { label: "CPC", unit: "devise" },
  cpm: { label: "CPM", unit: "devise" },
  ctr: { label: "CTR", unit: "%" },
  roas: { label: "ROAS", unit: "x" },
  frequence: { label: "Fréquence", unit: "" },
  depenses: { label: "Dépenses", unit: "devise" },
};

export const PERIODS: Record<string, string> = {
  yesterday: "hier",
  last_3d: "3 derniers jours",
  last_7d: "7 derniers jours",
  last_14d: "14 derniers jours",
  last_30d: "30 derniers jours",
};

export type WatchRule = {
  id: string; metric: string; operator: ">" | "<"; threshold: number; period: string; scope: string | null; label: string | null; active: boolean;
};

export function describeRule(r: Pick<WatchRule, "metric" | "operator" | "threshold" | "period" | "scope">, currency = "€") {
  const m = METRICS[r.metric];
  const unit = m?.unit === "devise" ? ` ${currency}` : m?.unit === "%" ? " %" : m?.unit === "x" ? "x" : "";
  return `${m?.label ?? r.metric} ${r.operator === ">" ? "au-dessus de" : "en dessous de"} ${r.threshold}${unit} (${PERIODS[r.period] ?? r.period})${r.scope ? ` · campagnes « ${r.scope} »` : " · toutes les campagnes actives"}`;
}
