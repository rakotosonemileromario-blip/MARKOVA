import type { GoogleSession, ToolDef } from "./google";

// Google Analytics 4 (lecture seule), via le compte Google connecté de l'utilisateur.
// Prérequis côté Google Cloud : « Google Analytics Data API » et « Google Analytics Admin API » activées.

export const ANALYTICS_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";

const API_FIX =
  "Pour débloquer : console.cloud.google.com → le projet du client OAuth → « API et services » → « Bibliothèque » → activer « Google Analytics Data API » et « Google Analytics Admin API ». " +
  "Puis, dans MARKOVA → Connexions → « Mettre à jour les autorisations » sur ce compte Google.";

async function ga<T>(s: GoogleSession, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${await s.token()}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 403 && /SERVICE_DISABLED|has not been used|is disabled/i.test(text)) throw new Error(`API Google Analytics non activée. ${API_FIX}`);
    if (res.status === 403 && /insufficient|scope/i.test(text)) throw new Error(`autorisation Google Analytics manquante sur ce compte. ${API_FIX}`);
    if (res.status === 403) throw new Error("ce compte Google n'a pas accès à cette propriété Analytics");
    throw new Error(`Google Analytics HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

type Summaries = { accountSummaries?: { displayName: string; propertySummaries?: { property: string; displayName: string }[] }[] };

async function properties(s: GoogleSession) {
  const r = await ga<Summaries>(s, "https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200");
  return (r.accountSummaries ?? []).flatMap((a) =>
    (a.propertySummaries ?? []).map((p) => ({ id: p.property.replace("properties/", ""), name: p.displayName, account: a.displayName })),
  );
}

const DIMENSIONS: Record<string, { api: string; label: string }> = {
  jour: { api: "date", label: "Jour" },
  source: { api: "sessionSourceMedium", label: "Source / support" },
  canal: { api: "sessionDefaultChannelGroup", label: "Canal" },
  page: { api: "pagePath", label: "Page" },
  pays: { api: "country", label: "Pays" },
  ville: { api: "city", label: "Ville" },
  appareil: { api: "deviceCategory", label: "Appareil" },
  campagne: { api: "sessionCampaignName", label: "Campagne" },
};

const METRICS = [
  { api: "activeUsers", label: "Utilisateurs" },
  { api: "newUsers", label: "Nouveaux" },
  { api: "sessions", label: "Sessions" },
  { api: "engagementRate", label: "Taux d'engagement", pct: true },
  { api: "averageSessionDuration", label: "Durée moy. (s)" },
  { api: "screenPageViews", label: "Pages vues" },
  { api: "keyEvents", label: "Conversions" },
] as const;

const fmt = (v: number, d = 0) => v.toLocaleString("fr-FR", { maximumFractionDigits: d, minimumFractionDigits: d });

type Report = { rows?: { dimensionValues: { value: string }[]; metricValues: { value: string }[] }[]; totals?: { metricValues: { value: string }[] }[]; rowCount?: number };

async function report(s: GoogleSession, args: Record<string, unknown>) {
  const all = await properties(s);
  if (!all.length) return "Aucune propriété Google Analytics accessible avec ce compte Google.";
  const w = String(args.propriete ?? "").trim().toLowerCase();
  const prop = w ? all.find((p) => p.id === w || p.name.toLowerCase().includes(w)) : all[0];
  if (!prop) return `(propriété « ${args.propriete} » absente de ce compte ; propriétés : ${all.map((p) => p.name).join(", ")})`;

  const dim = DIMENSIONS[String(args.repartition ?? "canal")] ?? DIMENSIONS.canal;
  const since = typeof args.date_debut === "string" && /^\d{4}-\d{2}-\d{2}$/.test(args.date_debut) ? args.date_debut : null;
  const until = typeof args.date_fin === "string" && /^\d{4}-\d{2}-\d{2}$/.test(args.date_fin) ? args.date_fin : null;
  const days = Math.min(Math.max(Number(args.jours ?? 28), 1), 365);
  const range = since && until ? { startDate: since, endDate: until } : { startDate: `${days}daysAgo`, endDate: "yesterday" };

  const r = await ga<Report>(s, `https://analyticsdata.googleapis.com/v1beta/properties/${prop.id}:runReport`, {
    dateRanges: [range],
    dimensions: [{ name: dim.api }],
    metrics: METRICS.map((m) => ({ name: m.api })),
    metricAggregations: ["TOTAL"],
    orderBys: dim.api === "date" ? [{ dimension: { dimensionName: "date" } }] : [{ metric: { metricName: "sessions" }, desc: true }],
    limit: 40,
  });
  const rows = r.rows ?? [];
  if (!rows.length) return `Google Analytics « ${prop.name} » : aucune donnée sur la période.`;
  const cell = (m: (typeof METRICS)[number], v: string) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return "—";
    return "pct" in m ? `${fmt(n * 100, 1)} %` : m.api === "averageSessionDuration" ? fmt(n) : fmt(n);
  };
  const total = r.totals?.[0]?.metricValues ?? [];
  const label = (v: string) => (dim.api === "date" ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : v || "(non défini)");
  return [
    `#### Google Analytics calculé par MARKOVA — ${prop.name} (${prop.account}) · ${since && until ? `du ${since} au ${until}` : `${days} derniers jours`} · par ${dim.label.toLowerCase()}`,
    total.length ? `Totaux : ${METRICS.map((m, i) => `${m.label} ${cell(m, total[i]?.value ?? "")}`).join(" · ")}` : "",
    "",
    `| ${dim.label} | ${METRICS.map((m) => m.label).join(" | ")} |`,
    `| --- | ${METRICS.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${label(row.dimensionValues[0]?.value ?? "")} | ${METRICS.map((m, i) => cell(m, row.metricValues[i]?.value ?? "")).join(" | ")} |`),
    (r.rowCount ?? 0) > rows.length ? `_(${(r.rowCount ?? 0) - rows.length} lignes de plus non affichées)_` : "",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

export const ANALYTICS_TOOLS: ToolDef[] = [
  {
    name: "analytics_proprietes",
    label: "📈 Sites Google Analytics",
    description: "Liste les propriétés Google Analytics 4 (sites, applis) accessibles avec les comptes Google connectés.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "analytics_rapport",
    label: "📈 Statistiques du site",
    description:
      "Statistiques exactes d'un site (Google Analytics 4) : utilisateurs, nouveaux, sessions, taux d'engagement, durée moyenne, pages vues, conversions, " +
      "réparties par repartition = jour | canal | source | page | pays | ville | appareil | campagne. Période : jours (défaut 28) ou date_debut + date_fin (AAAA-MM-JJ).",
    parameters: {
      type: "object",
      properties: {
        propriete: { type: "string", description: "Nom ou id de la propriété (défaut : la première)" },
        repartition: { type: "string", enum: Object.keys(DIMENSIONS) },
        jours: { type: "number" },
        date_debut: { type: "string" },
        date_fin: { type: "string" },
      },
    },
  },
];

/** Renvoie null si l'outil n'est pas un outil Analytics. */
export async function runAnalyticsTool(s: GoogleSession, name: string, args: Record<string, unknown>): Promise<string | null> {
  if (name === "analytics_proprietes") {
    const all = await properties(s);
    return all.length ? all.map((p) => `- ${p.name} · id ${p.id} · compte ${p.account}`).join("\n") : "Aucune propriété Google Analytics sur ce compte.";
  }
  if (name === "analytics_rapport") return report(s, args);
  return null;
}
