// Calcul déterministe des KPI publicitaires à partir d'un tableau (export Meta Ads, CSV, XLSX).
// Les modèles de langage calculent mal : MARKOVA fournit les chiffres, l'IA les interprète.

export type Row = Record<string, unknown>;

type Field = "name" | "spend" | "impressions" | "reach" | "clicks" | "leads" | "purchases" | "revenue" | "results";

// Ordre = priorité : le premier motif trouvé l'emporte (ex. « clics sur un lien » avant « clics »).
const PATTERNS: Record<Field, RegExp[]> = {
  name: [/nom de la publicite|ad name/, /nom de l.ensemble|ad set name/, /nom de la campagne|campaign name/, /^campagne$|^campaign$|^publicite$|^nom$|^name$/],
  spend: [/montant depense|amount spent|^depenses?|^spend|^cout total|^cost$/],
  impressions: [/^impressions?$/, /impressions/],
  reach: [/couverture|portee|^reach/],
  clicks: [/clics sur un lien|link clicks/, /^clics? \(tous\)|clicks \(all\)/, /^clics?$|^clicks?$/],
  leads: [/prospects|^leads?$|leads? \(formulaire\)|^leads/],
  purchases: [/^achats?$|^purchases?$/, /^conversions?$/],
  revenue: [/valeur de conversion|conversion value|revenus?|revenue|chiffre d.affaires/],
  results: [/^resultats?$|^results?$/],
};

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

export function detectColumns(headers: string[]): Partial<Record<Field, string>> {
  const found: Partial<Record<Field, string>> = {};
  const used = new Set<string>();
  for (const field of Object.keys(PATTERNS) as Field[]) {
    outer: for (const re of PATTERNS[field]) {
      for (const h of headers) {
        if (used.has(h)) continue;
        if (re.test(norm(h))) {
          found[field] = h;
          used.add(h);
          break outer;
        }
      }
    }
  }
  return found;
}

/** Parse « 1 234,56 € », « 1,234.56 », « 12,5 % »… en nombre. */
export function parseNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v == null) return null;
  let s = String(v).replace(/[\s  €$£%]/g, "").replace(/[A-Za-z]/g, "");
  if (!s || s === "-") return null;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > -1 && lastDot > -1) {
    s = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (lastComma > -1) {
    const decimals = s.length - lastComma - 1;
    s = decimals === 3 && s.indexOf(",") === lastComma ? s.replace(",", "") : s.replace(/,/g, ".");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

type Totals = Record<Exclude<Field, "name">, number | null>;

function kpis(t: Totals) {
  const div = (a: number | null, b: number | null, mult = 1) => (a != null && b ? (a / b) * mult : null);
  const conv = t.leads ?? t.results;
  return {
    CPM: div(t.spend, t.impressions, 1000),
    CTR: div(t.clicks, t.impressions, 100),
    CPC: div(t.spend, t.clicks),
    CPL: div(t.spend, conv),
    "Taux conv.": div(conv, t.clicks, 100),
    CPA: div(t.spend, t.purchases),
    ROAS: div(t.revenue, t.spend),
    Fréquence: div(t.impressions, t.reach),
  };
}

const fmt = (n: number | null, digits = 2) =>
  n == null ? "—" : n.toLocaleString("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits });

/**
 * Produit un résumé Markdown des KPI si le tableau ressemble à des statistiques publicitaires.
 * Renvoie null sinon.
 */
export function computeKpiSummary(rows: Row[], sheetName?: string): string | null {
  if (!rows.length) return null;
  const headers = Object.keys(rows[0]);
  const cols = detectColumns(headers);
  if (!cols.spend || !(cols.impressions || cols.clicks)) return null;

  const numeric = (Object.keys(cols) as Field[]).filter((f) => f !== "name");
  const perRow = rows
    .map((r) => {
      const t = Object.fromEntries(numeric.map((f) => [f, parseNumber(r[cols[f]!])])) as Totals;
      return { name: cols.name ? String(r[cols.name] ?? "").trim() : "", t };
    })
    // Ignore les lignes vides et les lignes de total éventuelles.
    .filter((r) => r.t.spend != null && !/^(total|resultats? de|results? from)/i.test(norm(r.name)));

  if (!perRow.length) return null;

  const allFields: Exclude<Field, "name">[] = ["spend", "impressions", "reach", "clicks", "leads", "purchases", "revenue", "results"];
  const totals = Object.fromEntries(
    allFields.map((f) => [f, cols[f] ? perRow.reduce((s, r) => s + (r.t[f] ?? 0), 0) : null]),
  ) as Totals;

  const k = kpis(totals);
  const lines: string[] = [];
  lines.push(`#### KPI calculés par MARKOVA${sheetName ? ` — feuille « ${sheetName} »` : ""}`);
  lines.push(`Colonnes reconnues : ${Object.entries(cols).map(([f, h]) => `${f} = « ${h} »`).join(", ")}.`);
  lines.push(`Lignes analysées : ${perRow.length}.`);
  lines.push("");
  lines.push("**Totaux**");
  lines.push(
    `Dépenses ${fmt(totals.spend)} · Impressions ${fmt(totals.impressions, 0)}` +
      (totals.reach != null ? ` · Portée ${fmt(totals.reach, 0)}` : "") +
      (totals.clicks != null ? ` · Clics ${fmt(totals.clicks, 0)}` : "") +
      (totals.leads != null ? ` · Leads ${fmt(totals.leads, 0)}` : "") +
      (totals.results != null && totals.leads == null ? ` · Résultats ${fmt(totals.results, 0)}` : "") +
      (totals.purchases != null ? ` · Achats ${fmt(totals.purchases, 0)}` : "") +
      (totals.revenue != null ? ` · Revenus ${fmt(totals.revenue)}` : ""),
  );
  lines.push(
    Object.entries(k)
      .filter(([, v]) => v != null)
      .map(([n, v]) => `${n} ${fmt(v)}${n === "CTR" || n === "Taux conv." ? " %" : ""}`)
      .join(" · "),
  );

  if (perRow.length > 1) {
    const cols2 = Object.keys(k).filter((n) => perRow.some((r) => kpis(r.t)[n as keyof typeof k] != null));
    lines.push("");
    lines.push(`| Élément | Dépenses | ${cols2.join(" | ")} |`);
    lines.push(`| --- | --- | ${cols2.map(() => "---").join(" | ")} |`);
    for (const r of perRow.slice(0, 60)) {
      const rk = kpis(r.t);
      lines.push(
        `| ${r.name || "—"} | ${fmt(r.t.spend)} | ${cols2
          .map((n) => fmt(rk[n as keyof typeof rk]) + (n === "CTR" || n === "Taux conv." ? " %" : ""))
          .join(" | ")} |`,
      );
    }
    if (perRow.length > 60) lines.push(`_(${perRow.length - 60} lignes supplémentaires non affichées)_`);
  }
  lines.push("");
  lines.push("_CPL calculé sur les leads, ou sur la colonne « Résultats » si aucune colonne leads n'existe._");
  return lines.join("\n");
}
