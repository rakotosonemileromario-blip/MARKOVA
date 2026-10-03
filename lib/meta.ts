import type { SupabaseClient } from "@supabase/supabase-js";
import { decrypt } from "./crypto";
import type { ToolSet } from "./llm";

// ─── Meta : Ads (Marketing API), Facebook Pages, Instagram ───────
// Lecture libre ; pause / réactivation / budget uniquement après validation (table « actions »).

export const META_VERSION = () => process.env.META_API_VERSION || "v26.0";
const GRAPH = () => `https://graph.facebook.com/${META_VERSION()}`;

export const META_SCOPES = [
  "ads_read",
  "ads_management",
  "business_management",
  "pages_show_list",
  "pages_read_engagement",
  "instagram_basic",
];

/**
 * Autorisations « avancées » (portée organique, statistiques de page, commentaires, statistiques Instagram).
 * Elles ne sont demandées que sur « Reconnecter avec les statistiques » : il faut d'abord les ajouter
 * aux cas d'utilisation de l'app Meta, sinon Facebook affiche « Invalid Scopes ».
 */
export const META_ADVANCED_SCOPES = ["read_insights", "pages_read_user_content"];

/** Explication donnée à l'agent (et à l'utilisateur) quand une autorisation Meta manque. */
export const META_PERMISSION_FIX =
  "Pour débloquer : 1) developers.facebook.com → app MARKOVA → « Cas d'utilisation » → « Gérer tout sur votre Page » → Personnaliser → ajouter read_insights et pages_read_user_content ; " +
  "2) dans MARKOVA → Connexions → « Reconnecter avec les statistiques ». En mode Développement, aucune validation Meta n'est nécessaire pour l'administrateur de l'app. " +
  "Ne donne PAS d'autres étapes (Business Manager, App Review…).";

// ─── App Meta (obligatoire pour « Connecter avec Facebook ») ─────
// Soit dans .env.local (META_APP_ID / META_APP_SECRET / META_CONFIG_ID),
// soit saisie dans MARKOVA (Connexions) et stockée chiffrée (integrations, provider « meta_app »).
export type MetaApp = { id: string; secret: string; configId?: string };

export async function getMetaApp(supabase: SupabaseClient): Promise<MetaApp | null> {
  if (process.env.META_APP_ID && process.env.META_APP_SECRET) {
    return { id: process.env.META_APP_ID, secret: process.env.META_APP_SECRET, configId: process.env.META_CONFIG_ID || undefined };
  }
  if (!process.env.TOKEN_ENCRYPTION_KEY) return null;
  const { data } = await supabase.from("integrations").select("account_email, refresh_token_enc").eq("provider", "meta_app").maybeSingle();
  if (!data) return null;
  try {
    const secret = JSON.parse(decrypt(data.refresh_token_enc)) as { secret: string; configId?: string };
    return { id: data.account_email, secret: secret.secret, configId: secret.configId || undefined };
  } catch {
    return null;
  }
}

/** Vérifie auprès de Meta que l'identifiant et la clé secrète de l'app sont valides. */
export async function verifyMetaApp(app: MetaApp) {
  await graph<{ access_token: string }>("oauth/access_token", "", { client_id: app.id, client_secret: app.secret, grant_type: "client_credentials" });
}

export function metaAuthUrl(origin: string, state: string, app: MetaApp, advanced = false) {
  const p = new URLSearchParams({
    client_id: app.id,
    redirect_uri: `${origin}/api/meta/callback`,
    state,
    response_type: "code",
  });
  // « Facebook Login for Business » : les permissions sont définies dans une configuration (config_id).
  // Sans configuration : Facebook Login classique avec la liste des permissions.
  if (app.configId) p.set("config_id", app.configId);
  else p.set("scope", [...META_SCOPES, ...(advanced ? META_ADVANCED_SCOPES : [])].join(","));
  return `https://www.facebook.com/${META_VERSION()}/dialog/oauth?${p}`;
}

type MetaError = { error?: { message: string; code?: number; error_subcode?: number } };

async function graph<T>(path: string, token: string, params: Record<string, string> = {}, method = "GET"): Promise<T> {
  const url = new URL(`${GRAPH()}/${path.replace(/^\//, "")}`);
  const body = new URLSearchParams(token ? { ...params, access_token: token } : params);
  const res =
    method === "GET"
      ? await fetch(`${url}?${body}`, { signal: AbortSignal.timeout(30_000) })
      : await fetch(url, { method, body, signal: AbortSignal.timeout(30_000) });
  const json = (await res.json()) as T & MetaError;
  if (!res.ok || json.error) {
    const e = json.error;
    if (e?.code === 190) throw new Error("jeton Meta expiré ou révoqué — reconnecte Meta dans Connexions");
    if (e?.code === 200 || e?.code === 10 || /permission|Public Content Access/i.test(e?.message ?? "")) {
      throw new Error(`autorisation Meta manquante (${e?.message}). ${META_PERMISSION_FIX}`);
    }
    if (e?.code === 17 || e?.code === 4 || e?.code === 80004) throw new Error("limite d'appels Meta atteinte, réessaie dans quelques minutes");
    throw new Error(`Meta : ${e?.message ?? `HTTP ${res.status}`}`);
  }
  return json;
}

/** Échange le code OAuth contre un jeton longue durée (≈ 60 jours). */
export async function metaExchangeCode(code: string, origin: string, app: MetaApp) {
  const short = await graph<{ access_token: string }>("oauth/access_token", "", {
    client_id: app.id,
    client_secret: app.secret,
    redirect_uri: `${origin}/api/meta/callback`,
    code,
  });
  return metaLongLived(short.access_token, app);
}

export async function metaLongLived(token: string, app: MetaApp) {
  const long = await graph<{ access_token: string; expires_in?: number }>("oauth/access_token", "", {
    grant_type: "fb_exchange_token",
    client_id: app.id,
    client_secret: app.secret,
    fb_exchange_token: token,
  });
  return { token: long.access_token, expiresAt: long.expires_in ? new Date(Date.now() + long.expires_in * 1000).toISOString() : null };
}

export async function metaMe(token: string) {
  return graph<{ id: string; name: string }>("me", token, { fields: "id,name" });
}

// ─── Session ─────────────────────────────────────────────────────
/** Éléments choisis par l'utilisateur (vide = tout ce que la connexion autorise). */
export type MetaSelection = { pages?: string[]; adAccounts?: string[] };
export type MetaSession = { name: string; token: string; selection?: MetaSelection; expiresAt?: string | null };

/** userId : obligatoire avec le client « service » des tâches planifiées (pas de RLS). */
export async function getMetaSession(supabase: SupabaseClient, userId?: string): Promise<MetaSession | null> {
  if (!process.env.TOKEN_ENCRYPTION_KEY) return null;
  const q = supabase.from("integrations").select("account_email, refresh_token_enc, settings, expires_at").eq("provider", "meta");
  const { data } = await (userId ? q.eq("user_id", userId) : q).order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (!data) return null;
  try {
    return {
      name: data.account_email,
      token: decrypt(data.refresh_token_enc),
      selection: (data.settings as MetaSelection) ?? {},
      expiresAt: data.expires_at ?? null,
    };
  } catch {
    return null;
  }
}

/** Toutes les pages (avec leur Instagram) et comptes pub accessibles, pour l'écran de sélection. */
export async function listMetaAssets(s: MetaSession) {
  const [p, a] = await Promise.all([
    graph<{ data: Page[] }>("me/accounts", s.token, { fields: "id,name,access_token,instagram_business_account{id,username}", limit: "100" }).catch(() => ({ data: [] as Page[] })),
    graph<{ data: AdAccount[] }>("me/adaccounts", s.token, { fields: "id,name,account_status,currency,timezone_name", limit: "100" }).catch(() => ({ data: [] as AdAccount[] })),
  ]);
  return {
    pages: (p.data ?? []).map((x) => ({ id: x.id, name: x.name, instagram: x.instagram_business_account?.username ?? null })),
    adAccounts: (a.data ?? []).map((x) => ({ id: x.id, name: x.name, currency: x.currency, active: x.account_status === 1 })),
  };
}

// ─── Utilitaires KPI ─────────────────────────────────────────────
type Action = { action_type: string; value: string };
const LEAD_TYPES = ["lead", "onsite_conversion.lead_grouped", "offsite_conversion.fb_pixel_lead", "leadgen_grouped"];
const PURCHASE_TYPES = ["purchase", "omni_purchase", "offsite_conversion.fb_pixel_purchase", "onsite_web_purchase"];

function pick(actions: Action[] | undefined, types: string[]) {
  for (const t of types) {
    const a = actions?.find((x) => x.action_type === t);
    if (a) return Number(a.value);
  }
  return null;
}

const n = (v: unknown) => (v == null || v === "" ? null : Number(v));
const fmt = (v: number | null, d = 2) => (v == null || !Number.isFinite(v) ? "—" : v.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d }));
const div = (a: number | null, b: number | null, m = 1) => (a != null && b ? (a / b) * m : null);

const PRESETS = ["today", "yesterday", "last_3d", "last_7d", "last_14d", "last_30d", "last_90d", "this_month", "last_month", "maximum"];

function periodParams(args: Record<string, unknown>): Record<string, string> {
  const since = typeof args.date_debut === "string" ? args.date_debut : "";
  const until = typeof args.date_fin === "string" ? args.date_fin : "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(since) && /^\d{4}-\d{2}-\d{2}$/.test(until)) return { time_range: JSON.stringify({ since, until }) };
  const preset = String(args.periode ?? "last_7d");
  return { date_preset: PRESETS.includes(preset) ? preset : "last_7d" };
}

type AdAccount = { id: string; name: string; account_status: number; currency: string; timezone_name: string; amount_spent?: string };

async function adAccounts(s: MetaSession) {
  const r = await graph<{ data: AdAccount[] }>("me/adaccounts", s.token, { fields: "id,name,account_status,currency,timezone_name,amount_spent", limit: "100" });
  const chosen = s.selection?.adAccounts;
  return (r.data ?? []).filter((a) => !chosen?.length || chosen.includes(a.id));
}

async function resolveAccount(s: MetaSession, wanted?: unknown) {
  const all = await adAccounts(s);
  if (!all.length) throw new Error("aucun compte publicitaire accessible avec cette connexion Meta");
  if (typeof wanted === "string" && wanted.trim()) {
    const w = wanted.toLowerCase().replace(/^act_/, "");
    const hit = all.find((a) => a.id.replace(/^act_/, "") === w || a.name.toLowerCase().includes(w));
    if (hit) return hit;
  }
  return all.find((a) => a.account_status === 1) ?? all[0];
}

// ─── Outils ──────────────────────────────────────────────────────
async function listAccounts(s: MetaSession) {
  const all = await adAccounts(s);
  if (!all.length) return "Aucun compte publicitaire accessible.";
  const status: Record<number, string> = { 1: "actif", 2: "désactivé", 3: "impayé", 7: "en revue", 9: "période de grâce", 101: "fermé" };
  return all.map((a) => `- ${a.name} · ${a.id} · ${status[a.account_status] ?? a.account_status} · ${a.currency} · ${a.timezone_name}`).join("\n");
}

type Insight = {
  campaign_id?: string; campaign_name?: string; adset_id?: string; adset_name?: string; ad_id?: string; ad_name?: string;
  spend?: string; impressions?: string; reach?: string; frequency?: string; clicks?: string; inline_link_clicks?: string;
  actions?: Action[]; action_values?: Action[]; date_start?: string; date_stop?: string;
};

async function performances(s: MetaSession, args: Record<string, unknown>) {
  const account = await resolveAccount(s, args.compte);
  const level = ({ campagne: "campaign", ensemble: "adset", publicite: "ad" } as Record<string, string>)[String(args.niveau ?? "campagne")] ?? "campaign";
  const idField = `${level}_id`;
  const nameFields = level === "campaign" ? "campaign_id,campaign_name" : level === "adset" ? "adset_id,adset_name,campaign_name" : "ad_id,ad_name,adset_name,campaign_name";

  const [ins, objects] = await Promise.all([
    graph<{ data: Insight[] }>(`${account.id}/insights`, s.token, {
      level,
      fields: `${nameFields},spend,impressions,reach,frequency,clicks,inline_link_clicks,actions,action_values`,
      limit: "200",
      ...periodParams(args),
    }),
    graph<{ data: { id: string; effective_status: string; daily_budget?: string; lifetime_budget?: string }[] }>(
      `${account.id}/${level === "campaign" ? "campaigns" : level === "adset" ? "adsets" : "ads"}`,
      s.token,
      { fields: `id,effective_status${level === "ad" ? "" : ",daily_budget,lifetime_budget"}`, limit: "500" },
    ),
  ]);
  const rows = ins.data ?? [];
  if (!rows.length) return `Aucune donnée de diffusion pour ${account.name} sur la période.`;
  const byId = new Map((objects.data ?? []).map((o) => [o.id, o]));
  const cur = account.currency;

  const tot = { spend: 0, impr: 0, reach: 0, link: 0, leads: 0, purch: 0, rev: 0, hasLeads: false, hasPurch: false };
  const lines = rows
    .map((r) => {
      const spend = n(r.spend) ?? 0;
      const impr = n(r.impressions) ?? 0;
      const link = n(r.inline_link_clicks) ?? n(r.clicks) ?? 0;
      const leads = pick(r.actions, LEAD_TYPES);
      const purch = pick(r.actions, PURCHASE_TYPES);
      const rev = pick(r.action_values, PURCHASE_TYPES);
      tot.spend += spend; tot.impr += impr; tot.reach += n(r.reach) ?? 0; tot.link += link;
      if (leads != null) { tot.leads += leads; tot.hasLeads = true; }
      if (purch != null) { tot.purch += purch; tot.hasPurch = true; }
      if (rev != null) tot.rev += rev;
      const obj = byId.get(String((r as Record<string, unknown>)[idField] ?? ""));
      const budget = obj?.daily_budget ? `${fmt(Number(obj.daily_budget) / 100)} ${cur}/j` : obj?.lifetime_budget ? `${fmt(Number(obj.lifetime_budget) / 100)} ${cur} total` : "—";
      const name = level === "campaign" ? r.campaign_name : level === "adset" ? `${r.adset_name} (${r.campaign_name})` : `${r.ad_name} (${r.adset_name})`;
      return `| ${name} · id ${(r as Record<string, unknown>)[idField]} | ${obj?.effective_status ?? "?"} | ${budget} | ${fmt(spend)} | ${fmt(impr, 0)} | ${fmt(n(r.frequency))} | ${fmt(div(spend, impr, 1000))} | ${fmt(div(link, impr, 100))} % | ${fmt(div(spend, link))} | ${leads ?? "—"} | ${fmt(div(spend, leads))} | ${purch ?? "—"} | ${fmt(div(spend, purch))} | ${fmt(div(rev, spend))} |`;
    })
    .join("\n");

  const period = rows[0].date_start && rows[0].date_stop ? `du ${rows[0].date_start} au ${rows[0].date_stop}` : "";
  return [
    `#### KPI Meta Ads calculés par MARKOVA — ${account.name} (${account.id}) · ${period} · devise ${cur}`,
    `Totaux : dépenses ${fmt(tot.spend)} ${cur} · impressions ${fmt(tot.impr, 0)} · clics lien ${fmt(tot.link, 0)} · CPM ${fmt(div(tot.spend, tot.impr, 1000))} · CTR ${fmt(div(tot.link, tot.impr, 100))} % · CPC ${fmt(div(tot.spend, tot.link))}` +
      (tot.hasLeads ? ` · leads ${tot.leads} · CPL ${fmt(div(tot.spend, tot.leads))}` : "") +
      (tot.hasPurch ? ` · achats ${tot.purch} · CPA ${fmt(div(tot.spend, tot.purch))} · ROAS ${fmt(div(tot.rev, tot.spend))}` : ""),
    "",
    `| ${level === "campaign" ? "Campagne" : level === "adset" ? "Ensemble" : "Publicité"} | Statut | Budget | Dépenses | Impr. | Fréq. | CPM | CTR lien | CPC | Leads | CPL | Achats | CPA | ROAS |`,
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    lines,
    "",
    "_CTR/CPC sur les clics sur lien. Utilise les id pour proposer une action (pause, réactivation, budget)._",
  ].join("\n");
}

/** KPI chiffrés par campagne (tous les comptes pub choisis) : utilisés par la surveillance automatique. */
export type CampaignMetrics = {
  account: string; currency: string; id: string; name: string; status: string;
  depenses: number; impressions: number; frequence: number | null;
  cpm: number | null; ctr: number | null; cpc: number | null; cpl: number | null; cpa: number | null; roas: number | null;
  leads: number | null; achats: number | null; clics: number;
};

export async function campaignMetrics(s: MetaSession, periode: string): Promise<CampaignMetrics[]> {
  const out: CampaignMetrics[] = [];
  for (const account of (await adAccounts(s)).filter((a) => a.account_status === 1)) {
    const [ins, camps] = await Promise.all([
      graph<{ data: Insight[] }>(`${account.id}/insights`, s.token, {
        level: "campaign",
        fields: "campaign_id,campaign_name,spend,impressions,frequency,clicks,inline_link_clicks,actions,action_values",
        limit: "200",
        ...periodParams({ periode }),
      }),
      graph<{ data: { id: string; effective_status: string }[] }>(`${account.id}/campaigns`, s.token, { fields: "id,effective_status", limit: "500" }),
    ]);
    const status = new Map((camps.data ?? []).map((c) => [c.id, c.effective_status]));
    for (const r of ins.data ?? []) {
      const spend = n(r.spend) ?? 0;
      const impr = n(r.impressions) ?? 0;
      const link = n(r.inline_link_clicks) ?? n(r.clicks) ?? 0;
      const leads = pick(r.actions, LEAD_TYPES);
      const purch = pick(r.actions, PURCHASE_TYPES);
      const rev = pick(r.action_values, PURCHASE_TYPES);
      out.push({
        account: account.name, currency: account.currency, id: String(r.campaign_id), name: String(r.campaign_name ?? ""),
        status: status.get(String(r.campaign_id)) ?? "?",
        depenses: spend, impressions: impr, frequence: n(r.frequency),
        cpm: div(spend, impr, 1000), ctr: div(link, impr, 100), cpc: div(spend, link),
        cpl: div(spend, leads), cpa: div(spend, purch), roas: purch != null ? div(rev, spend) : null,
        leads, achats: purch, clics: link,
      });
    }
  }
  return out;
}

type AdWithCreative = {
  id: string; name: string; effective_status: string;
  creative?: { title?: string; body?: string; call_to_action_type?: string; thumbnail_url?: string; object_type?: string; video_id?: string };
  adset?: { name: string }; campaign?: { name: string };
};

async function creatives(s: MetaSession, args: Record<string, unknown>) {
  const account = await resolveAccount(s, args.compte);
  const r = await graph<{ data: AdWithCreative[] }>(`${account.id}/ads`, s.token, {
    fields: "id,name,effective_status,adset{name},campaign{name},creative{title,body,call_to_action_type,thumbnail_url,object_type,video_id}",
    limit: String(Math.min(Number(args.max ?? 25), 50)),
    ...(args.actives_seulement === false ? {} : { effective_status: JSON.stringify(["ACTIVE"]) }),
  });
  const ads = r.data ?? [];
  if (!ads.length) return "Aucune publicité trouvée.";
  return ads
    .map((a) =>
      [
        `- **${a.name}** · id ${a.id} · ${a.effective_status} · ${a.campaign?.name ?? ""} › ${a.adset?.name ?? ""}`,
        a.creative?.object_type ? `  format : ${a.creative.video_id ? "vidéo" : a.creative.object_type.toLowerCase()}` : "",
        a.creative?.title ? `  titre : ${a.creative.title}` : "",
        a.creative?.body ? `  texte : ${a.creative.body.replace(/\s+/g, " ").slice(0, 500)}` : "",
        a.creative?.call_to_action_type ? `  CTA : ${a.creative.call_to_action_type}` : "",
        a.creative?.thumbnail_url ? `  aperçu : ${a.creative.thumbnail_url}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n");
}

type Page = { id: string; name: string; access_token: string; instagram_business_account?: { id: string; username?: string } };

async function pages(s: MetaSession) {
  const r = await graph<{ data: Page[] }>("me/accounts", s.token, { fields: "id,name,access_token,instagram_business_account{id,username}", limit: "100" });
  const chosen = s.selection?.pages;
  return (r.data ?? []).filter((p) => !chosen?.length || chosen.includes(p.id));
}

/** « 𝙅𝙊𝙆𝙀𝙉𝘼𝙔 », « Jokénay » → « jokenay » : les noms de pages utilisent souvent des lettres stylisées. */
const plainName = (s: string) =>
  s.normalize("NFKC").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

async function pickPage(s: MetaSession, wanted?: unknown) {
  const all = await pages(s);
  if (!all.length) throw new Error("aucune page Facebook accessible");
  const w = typeof wanted === "string" ? plainName(wanted.replace(/^@/, "")) : "";
  if (!w) return all[0];
  const hit =
    all.find((p) => plainName(p.name) === w) ??
    all.find((p) => plainName(p.name).includes(w) || (p.instagram_business_account?.username && plainName(p.instagram_business_account.username).includes(w)));
  if (!hit) throw new Error(`page « ${wanted} » introuvable. Pages connectées : ${all.map((p) => p.name).join(", ")}`);
  return hit;
}

/** Autorisations réellement accordées à la connexion Meta. */
async function grantedPermissions(s: MetaSession) {
  const r = await graph<{ data: { permission: string; status: string }[] }>("me/permissions", s.token).catch(() => ({ data: [] }));
  return new Set((r.data ?? []).filter((p) => p.status === "granted").map((p) => p.permission));
}

type FbPost = {
  id: string; message?: string; created_time: string; permalink_url?: string; status_type?: string;
  shares?: { count: number }; reactions?: { summary: { total_count: number } }; comments?: { summary: { total_count: number } };
};

const isPermissionError = (err: unknown) => err instanceof Error && err.message.startsWith("autorisation Meta manquante");

async function facebookPosts(s: MetaSession, args: Record<string, unknown>) {
  const page = await pickPage(s, args.page);
  const limit = String(Math.min(Number(args.max ?? 15), 50));
  // Du plus complet au plus simple : le nombre de commentaires exige pages_read_user_content,
  // les réactions exigent pages_read_engagement. On garde ce qui est autorisé.
  const attempts = [
    "message,created_time,permalink_url,status_type,shares,reactions.summary(true).limit(0),comments.summary(true).limit(0)",
    "message,created_time,permalink_url,status_type,shares,reactions.summary(true).limit(0)",
    "message,created_time,permalink_url,status_type,shares",
  ];
  let posts: FbPost[] = [];
  let missing = "";
  for (const [i, fields] of attempts.entries()) {
    try {
      posts = (await graph<{ data: FbPost[] }>(`${page.id}/published_posts`, page.access_token, { fields, limit })).data ?? [];
      if (i > 0) missing = i === 1 ? "nombre de commentaires" : "réactions et commentaires";
      break;
    } catch (err) {
      if (!isPermissionError(err) || i === attempts.length - 1) throw err;
    }
  }
  if (!posts.length) return `Aucune publication récente sur ${page.name}.`;

  // Portée par publication (read_insights) : tentée une fois, ignorée si l'autorisation manque.
  const reach = new Map<string, number>();
  let reachNote = "";
  // Meta a remplacé post_impressions_unique par post_total_media_view_unique (personnes qui ont vu la publication).
  const postReach = async (id: string) => {
    const ins = await graph<{ data: { name: string; values: { value: number }[] }[] }>(`${id}/insights`, page.access_token, { metric: "post_total_media_view_unique" });
    const v = ins.data?.[0]?.values?.[0]?.value;
    if (typeof v === "number") reach.set(id, v);
  };
  if ((await grantedPermissions(s)).has("read_insights")) {
    await Promise.all(posts.slice(0, 25).map((p) => postReach(p.id).catch(() => {})));
  } else {
    reachNote = "portée par publication (autorisation read_insights non accordée)";
  }
  const lacking = [missing, reachNote].filter(Boolean).join(", ");

  return (
    `Page Facebook « ${page.name} » — ${posts.length} publications récentes :\n` +
    posts
      .map(
        (p) =>
          `- ${p.created_time.slice(0, 10)}${p.status_type ? ` · ${p.status_type}` : ""}${reach.has(p.id) ? ` · portée ${reach.get(p.id)}` : ""} · réactions ${p.reactions?.summary.total_count ?? "—"} · commentaires ${p.comments?.summary.total_count ?? "—"} · partages ${p.shares?.count ?? 0}\n  ${(p.message ?? "(sans texte)").replace(/\s+/g, " ").slice(0, 300)}${p.permalink_url ? `\n  ${p.permalink_url}` : ""}`,
      )
      .join("\n") +
    (lacking ? `\n\n_Non disponible avec les autorisations actuelles : ${lacking}. ${META_PERMISSION_FIX}_` : "")
  );
}

/** Chiffres d'une publication organique (null = non disponible avec les autorisations actuelles). */
export type OrganicPost = {
  source: "facebook" | "instagram"; account: string; id: string; date: string; text: string; link: string;
  likes: number | null; commentaires: number | null; partages: number | null; vues: number | null;
};

/**
 * Publications des N derniers jours, en chiffres, pour toutes les pages (ou comptes Instagram) choisis :
 * utilisées par la surveillance automatique. `accounts` : noms visés (vide = tous).
 */
export async function organicPosts(s: MetaSession, source: "facebook" | "instagram", days: number, accounts: string[] = []) {
  const wanted = accounts.map(plainName);
  const match = (name: string) => !wanted.length || wanted.some((w) => plainName(name).includes(w));
  const since = Math.floor(Date.now() / 1000) - days * 86_400;
  const canInsights = (await grantedPermissions(s)).has("read_insights");
  const out: OrganicPost[] = [];

  for (const page of await pages(s)) {
    if (source === "facebook") {
      if (!match(page.name)) continue;
      let posts: FbPost[] = [];
      for (const fields of [
        "message,created_time,permalink_url,shares,reactions.summary(true).limit(0),comments.summary(true).limit(0)",
        "message,created_time,permalink_url,shares,reactions.summary(true).limit(0)",
        "message,created_time,permalink_url,shares",
      ]) {
        try {
          posts = (await graph<{ data: FbPost[] }>(`${page.id}/published_posts`, page.access_token, { fields, since: String(since), limit: "100" })).data ?? [];
          break;
        } catch (err) {
          if (!isPermissionError(err)) throw err;
        }
      }
      const views = new Map<string, number>();
      if (canInsights) {
        await Promise.all(
          posts.map(async (p) => {
            const r = await graph<{ data: { values: { value: number }[] }[] }>(`${p.id}/insights`, page.access_token, { metric: "post_media_view" }).catch(() => null);
            const v = r?.data?.[0]?.values?.[0]?.value;
            if (typeof v === "number") views.set(p.id, v);
          }),
        );
      }
      for (const p of posts) {
        out.push({
          source, account: page.name, id: p.id, date: p.created_time, text: (p.message ?? "").slice(0, 120), link: p.permalink_url ?? "",
          likes: p.reactions ? p.reactions.summary.total_count : null,
          commentaires: p.comments ? p.comments.summary.total_count : null,
          partages: p.shares?.count ?? 0,
          vues: views.get(p.id) ?? null,
        });
      }
    } else {
      const ig = page.instagram_business_account;
      if (!ig || !(match(page.name) || match(ig.username ?? ""))) continue;
      const media = await graph<{ data: { id: string; caption?: string; timestamp: string; permalink: string; like_count?: number; comments_count?: number }[] }>(
        `${ig.id}/media`,
        page.access_token,
        { fields: "id,caption,timestamp,permalink,like_count,comments_count", since: String(since), limit: "100" },
      );
      for (const m of (media.data ?? []).filter((x) => new Date(x.timestamp).getTime() / 1000 >= since)) {
        const r = await graph<{ data: { values: { value: number }[] }[] }>(`${m.id}/insights`, page.access_token, { metric: "views" }).catch(() => null);
        const v = r?.data?.[0]?.values?.[0]?.value;
        out.push({
          source, account: `@${ig.username ?? page.name}`, id: m.id, date: m.timestamp, text: (m.caption ?? "").slice(0, 120), link: m.permalink,
          likes: m.like_count ?? null, commentaires: m.comments_count ?? null, partages: null, vues: typeof v === "number" ? v : null,
        });
      }
    }
  }
  return out;
}

/** Noms des pages et comptes Instagram connectés (pour les choix de l'interface). */
export async function connectedAccounts(s: MetaSession) {
  const all = await pages(s).catch(() => [] as Page[]);
  return {
    facebook: all.map((p) => p.name),
    instagram: all.flatMap((p) => (p.instagram_business_account ? [`@${p.instagram_business_account.username ?? p.name}`] : [])),
  };
}

/** Pages Facebook et comptes Instagram connectés (ceux choisis dans Connexions). */
async function listPages(s: MetaSession) {
  const all = await pages(s);
  if (!all.length) return "Aucune page Facebook accessible avec cette connexion (vérifie le choix des pages dans Connexions).";
  const details = await Promise.all(
    all.map(async (p) => {
      type Info = { fan_count?: number; followers_count?: number; category?: string; location?: { country?: string; city?: string } };
      const info =
        (await graph<Info>(p.id, p.access_token, { fields: "fan_count,followers_count,category,location" }).catch(() => null)) ??
        (await graph<Info>(p.id, p.access_token, { fields: "fan_count,followers_count,category" }).catch(() => null));
      const where = [info?.location?.city, info?.location?.country].filter(Boolean).join(", ");
      return `- **${p.name}** · id ${p.id}${info?.category ? ` · ${info.category}` : ""}${where ? ` · lieu ${where}` : ""}${info?.followers_count != null ? ` · ${info.followers_count} abonnés` : ""}${info?.fan_count != null ? ` · ${info.fan_count} mentions J'aime` : ""}${p.instagram_business_account ? ` · Instagram @${p.instagram_business_account.username ?? p.instagram_business_account.id}` : " · pas d'Instagram pro relié"}`;
    }),
  );
  return `${all.length} page(s) connectée(s) :\n${details.join("\n")}`;
}

/** Statistiques d'une page sur une période (read_insights). */
async function pageInsights(s: MetaSession, args: Record<string, unknown>) {
  const page = await pickPage(s, args.page);
  if (!(await grantedPermissions(s)).has("read_insights")) {
    throw new Error(`autorisation Meta manquante (read_insights non accordée : statistiques de page impossibles). ${META_PERMISSION_FIX}`);
  }
  const days = Math.min(Math.max(Number(args.jours ?? 28), 1), 90);
  const until = Math.floor(Date.now() / 1000);
  const since = until - days * 86_400;
  // Métriques actuelles de Meta (les anciennes « impressions » ont été supprimées au profit des « vues »).
  const metrics = ["page_total_media_view_unique", "page_media_view", "page_post_engagements", "page_views_total", "page_daily_follows_unique", "page_follows"];
  const rows: string[] = [];
  for (const metric of metrics) {
    try {
      const r = await graph<{ data: { name: string; values: { value: number; end_time: string }[] }[] }>(`${page.id}/insights`, page.access_token, {
        metric,
        period: "day",
        since: String(since),
        until: String(until),
      });
      const values = r.data?.[0]?.values ?? [];
      if (!values.length) continue;
      const series = values.map((v) => `${v.end_time.slice(5, 10)}:${v.value}`).join(" ");
      if (metric === "page_follows") {
        // Cumul : on donne la valeur actuelle et l'évolution, pas une somme.
        const first = Number(values[0].value) || 0;
        const last = Number(values[values.length - 1].value) || 0;
        rows.push(`- ${metric} : ${last} abonnés aujourd'hui (${last - first >= 0 ? "+" : ""}${last - first} sur la période ; par jour ${series})`);
        continue;
      }
      const total = values.reduce((a, v) => a + (typeof v.value === "number" ? v.value : 0), 0);
      rows.push(`- ${metric} : total ${total} (par jour ${series})`);
    } catch (err) {
      if (isPermissionError(err)) throw err;
      // métrique indisponible pour cette page : on continue
    }
  }
  if (!rows.length) return `Aucune statistique disponible pour ${page.name} sur ${days} jours.`;
  return (
    `Statistiques de la page « ${page.name} » — ${days} derniers jours ` +
    `(page_total_media_view_unique = personnes touchées / portée, page_media_view = vues des contenus, page_post_engagements = interactions, page_views_total = visites de la page, page_daily_follows_unique = nouveaux abonnés par jour, page_follows = total d'abonnés) :\n${rows.join("\n")}`
  );
}

async function instagramPosts(s: MetaSession, args: Record<string, unknown>) {
  const all = await pages(s);
  const w = typeof args.compte === "string" ? args.compte.toLowerCase().replace(/^@/, "") : "";
  const page = all.find((p) => p.instagram_business_account && (!w || p.instagram_business_account.username?.toLowerCase().includes(w) || p.name.toLowerCase().includes(w)));
  const ig = page?.instagram_business_account;
  if (!page || !ig) return "Aucun compte Instagram professionnel relié à une page Facebook accessible.";
  const [profile, media] = await Promise.all([
    graph<{ username: string; followers_count?: number; media_count?: number }>(ig.id, page.access_token, { fields: "username,followers_count,media_count" }),
    graph<{ data: { id: string; caption?: string; media_type: string; media_product_type?: string; timestamp: string; permalink: string; like_count?: number; comments_count?: number }[] }>(
      `${ig.id}/media`,
      page.access_token,
      { fields: "id,caption,media_type,media_product_type,timestamp,permalink,like_count,comments_count", limit: String(Math.min(Number(args.max ?? 12), 30)) },
    ),
  ]);
  const lines = await Promise.all(
    (media.data ?? []).map(async (m) => {
      // Statistiques par publication (certaines métriques n'existent pas pour tous les formats).
      let stats = "";
      try {
        const ins = await graph<{ data: { name: string; values: { value: number }[] }[] }>(`${m.id}/insights`, page.access_token, { metric: "reach,views,saved,shares,total_interactions" });
        stats = ins.data.map((d) => `${d.name} ${d.values?.[0]?.value ?? "—"}`).join(" · ");
      } catch {
        stats = "";
      }
      return `- ${m.timestamp.slice(0, 10)} · ${m.media_product_type === "REELS" ? "Reel" : m.media_type.toLowerCase()} · likes ${m.like_count ?? 0} · commentaires ${m.comments_count ?? 0}${stats ? ` · ${stats}` : ""}\n  ${(m.caption ?? "").replace(/\s+/g, " ").slice(0, 250)}\n  ${m.permalink}`;
    }),
  );
  return `Instagram @${profile.username} · ${profile.followers_count ?? "?"} abonnés · ${profile.media_count ?? "?"} publications\n${lines.join("\n")}`;
}

// ─── Audiences et ciblage ────────────────────────────────────────
const BREAKDOWNS: Record<string, { breakdowns: string; label: string }> = {
  age_sexe: { breakdowns: "age,gender", label: "Âge et sexe" },
  pays: { breakdowns: "country", label: "Pays" },
  region: { breakdowns: "region", label: "Région" },
  plateforme: { breakdowns: "publisher_platform,platform_position", label: "Plateforme et placement" },
};
const GENDER: Record<string, string> = { male: "hommes", female: "femmes", unknown: "inconnu" };

/** Qui voit, clique et convertit : statistiques des pubs ventilées par âge / sexe, pays, région ou placement. */
async function adsDemographics(s: MetaSession, args: Record<string, unknown>) {
  const account = await resolveAccount(s, args.compte);
  const b = BREAKDOWNS[String(args.repartition ?? "age_sexe")] ?? BREAKDOWNS.age_sexe;
  const campaign = typeof args.campagne === "string" && args.campagne.trim() ? args.campagne.trim() : "";
  type Row = Insight & Record<string, string | undefined>;
  const r = await graph<{ data: Row[] }>(`${account.id}/insights`, s.token, {
    level: "account",
    breakdowns: b.breakdowns,
    fields: "spend,impressions,reach,inline_link_clicks,clicks,actions",
    limit: "500",
    ...(campaign ? { filtering: JSON.stringify([{ field: "campaign.name", operator: "CONTAIN", value: campaign }]) } : {}),
    ...periodParams(args),
  });
  const rows = (r.data ?? [])
    .map((x) => {
      const spend = n(x.spend) ?? 0;
      const impr = n(x.impressions) ?? 0;
      const link = n(x.inline_link_clicks) ?? n(x.clicks) ?? 0;
      const leads = pick(x.actions, LEAD_TYPES);
      const purch = pick(x.actions, PURCHASE_TYPES);
      const seg = b.breakdowns
        .split(",")
        .map((k) => (k === "gender" ? (GENDER[x.gender ?? ""] ?? x.gender) : x[k]))
        .filter(Boolean)
        .join(" · ");
      return { seg, spend, impr, reach: n(x.reach) ?? 0, link, leads, purch };
    })
    .filter((x) => x.impr > 0)
    .sort((a, z) => z.spend - a.spend);
  if (!rows.length) return `Aucune diffusion sur la période pour ${account.name}${campaign ? ` (campagnes « ${campaign} »)` : ""}.`;
  const tot = rows.reduce((a, x) => a + x.spend, 0);
  const cur = account.currency;
  return [
    `#### Audience des publicités — ${b.label} · ${account.name}${campaign ? ` · campagnes « ${campaign} »` : ""} · ${rows[0] && r.data?.[0]?.date_start ? `du ${r.data[0].date_start} au ${r.data[0].date_stop}` : ""} · devise ${cur}`,
    `| Segment | Dépenses | Part | Impr. | Portée | CTR lien | CPC | Leads | CPL | Achats | CPA |`,
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows.slice(0, 40).map(
      (x) =>
        `| ${x.seg} | ${fmt(x.spend)} | ${fmt(div(x.spend, tot, 100), 1)} % | ${fmt(x.impr, 0)} | ${fmt(x.reach, 0)} | ${fmt(div(x.link, x.impr, 100))} % | ${fmt(div(x.spend, x.link))} | ${x.leads ?? "—"} | ${fmt(div(x.spend, x.leads))} | ${x.purch ?? "—"} | ${fmt(div(x.spend, x.purch))} |`,
    ),
    rows.length > 40 ? `_(${rows.length - 40} segments de plus, non affichés)_` : "",
    "_Segments triés par dépenses. Compare le CPL / CPA de chaque segment à la moyenne avant de recommander un ciblage : un segment avec peu de dépenses n'est pas significatif._",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Abonnés Instagram par âge, sexe, ville et pays (autorisation instagram_manage_insights). */
async function instagramDemographics(s: MetaSession, args: Record<string, unknown>) {
  const all = await pages(s);
  const w = typeof args.compte_instagram === "string" ? plainName(args.compte_instagram.replace(/^@/, "")) : "";
  const page = all.find((p) => p.instagram_business_account && (!w || plainName(p.instagram_business_account.username ?? "").includes(w) || plainName(p.name).includes(w)));
  const ig = page?.instagram_business_account;
  if (!page || !ig) return "Aucun compte Instagram professionnel relié à une page Facebook accessible.";
  const out: string[] = [];
  for (const [breakdown, label] of [["age", "Âge"], ["gender", "Sexe"], ["country", "Pays"], ["city", "Villes"]] as const) {
    type Res = { data: { total_value?: { breakdowns?: { results?: { dimension_values: string[]; value: number }[] }[] } }[] };
    const r = await graph<Res>(`${ig.id}/insights`, page.access_token, { metric: "follower_demographics", period: "lifetime", metric_type: "total_value", breakdown }).catch((err) => {
      if (!isPermissionError(err)) throw err;
      throw new Error(
        "statistiques d'abonnés Instagram indisponibles : l'autorisation instagram_manage_insights n'est pas accordée à l'app Meta de MARKOVA (elle n'est pas encore demandée à la connexion). " +
          "Utilise meta_demographie source « pubs » (qui voit et convertit avec les publicités) à la place.",
      );
    });
    const results = (r.data?.[0]?.total_value?.breakdowns?.[0]?.results ?? []).sort((a, z) => z.value - a.value).slice(0, 12);
    const total = results.reduce((a, x) => a + x.value, 0);
    if (results.length) {
      out.push(`${label} : ${results.map((x) => `${breakdown === "gender" ? ({ M: "hommes", F: "femmes", U: "inconnu" }[x.dimension_values[0]] ?? x.dimension_values[0]) : x.dimension_values.join(" ")} ${x.value} (${fmt(div(x.value, total, 100), 0)} %)`).join(" · ")}`);
    }
  }
  if (!out.length) return `Instagram @${ig.username ?? ""} : pas de données démographiques (Meta les fournit à partir de 100 abonnés).`;
  return `#### Abonnés Instagram @${ig.username ?? ""} — répartition\n${out.map((l) => `- ${l}`).join("\n")}`;
}

async function demographics(s: MetaSession, args: Record<string, unknown>) {
  const source = String(args.source ?? "pubs");
  if (source === "instagram") return instagramDemographics(s, args);
  if (source === "facebook") {
    return "Meta ne fournit plus la répartition par âge, sexe ou ville des abonnés d'une page Facebook (statistiques supprimées de l'API). Utilise source « pubs » (qui voit et convertit avec tes publicités) ou « instagram ».";
  }
  return adsDemographics(s, args);
}

type CustomAudience = {
  id: string; name: string; subtype?: string; description?: string; time_created?: number;
  approximate_count_lower_bound?: number; approximate_count_upper_bound?: number;
  delivery_status?: { code: number; description?: string }; operation_status?: { code: number; description?: string };
};

/** Audiences personnalisées et similaires existantes, pixels et pages utilisables comme source. */
async function listAudiences(s: MetaSession, args: Record<string, unknown>) {
  const account = await resolveAccount(s, args.compte);
  const [aud, pixels, pgs] = await Promise.all([
    graph<{ data: CustomAudience[] }>(`${account.id}/customaudiences`, s.token, {
      fields: "id,name,subtype,description,approximate_count_lower_bound,approximate_count_upper_bound,delivery_status,operation_status",
      limit: "100",
    }),
    graph<{ data: { id: string; name: string; last_fired_time?: string }[] }>(`${account.id}/adspixels`, s.token, { fields: "id,name,last_fired_time" }).catch(() => ({ data: [] })),
    pages(s).catch(() => [] as Page[]),
  ]);
  const size = (a: CustomAudience) =>
    a.approximate_count_lower_bound != null && a.approximate_count_lower_bound >= 0
      ? `${fmt(a.approximate_count_lower_bound, 0)}–${fmt(a.approximate_count_upper_bound ?? null, 0)} personnes`
      : "taille inconnue";
  const list = (aud.data ?? []).map(
    (a) => `- **${a.name}** · id ${a.id} · ${a.subtype ?? "?"} · ${size(a)}${a.delivery_status?.description ? ` · ${a.delivery_status.description}` : ""}`,
  );
  return [
    `#### Audiences du compte ${account.name} (${account.id})`,
    list.length ? list.join("\n") : "Aucune audience personnalisée.",
    "",
    `Pixels : ${(pixels.data ?? []).map((p) => `${p.name} (id ${p.id}${p.last_fired_time ? `, dernier événement ${p.last_fired_time.slice(0, 10)}` : ", jamais déclenché"})`).join(" · ") || "aucun"}`,
    `Pages (source d'audiences d'engagement) : ${pgs.map((p) => `${p.name}${p.instagram_business_account ? ` + Instagram @${p.instagram_business_account.username ?? ""}` : ""}`).join(" · ") || "aucune"}`,
    "_Pour créer une audience : proposer_action avec meta_audience_similaire, meta_audience_engagement ou meta_audience_site._",
  ].join("\n");
}

/** Centres d'intérêt ciblables (taille d'audience estimée par Meta). */
async function searchInterests(s: MetaSession, args: Record<string, unknown>) {
  const q = String(args.recherche ?? "").trim();
  if (!q) return "Indique un mot à rechercher.";
  const r = await graph<{ data: { id: string; name: string; audience_size_lower_bound?: number; audience_size_upper_bound?: number; path?: string[]; topic?: string }[] }>(
    "search",
    s.token,
    { type: "adinterest", q, limit: "20", locale: "fr_FR" },
  );
  if (!r.data?.length) return `Aucun centre d'intérêt Meta pour « ${q} ».`;
  return (
    `Centres d'intérêt Meta pour « ${q} » (taille mondiale estimée) :\n` +
    r.data
      .map((i) => `- ${i.name} · id ${i.id} · ${i.audience_size_lower_bound != null ? `${fmt(i.audience_size_lower_bound, 0)}–${fmt(i.audience_size_upper_bound ?? null, 0)}` : "?"}${i.path?.length ? ` · ${i.path.join(" › ")}` : ""}`)
      .join("\n")
  );
}

export const META_TOOLS: ToolSet["defs"] = [
  {
    name: "meta_comptes_pub",
    label: "📢 Comptes Meta Ads",
    description: "Liste les comptes publicitaires Meta accessibles (nom, id, statut, devise).",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "meta_performances",
    label: "📊 Performances Meta Ads",
    description:
      "KPI Meta Ads calculés exactement (dépenses, impressions, fréquence, CPM, CTR lien, CPC, leads, CPL, achats, CPA, ROAS, statut, budget) par campagne, ensemble de publicités ou publicité. " +
      "Période : periode (today, yesterday, last_7d, last_14d, last_30d, last_90d, this_month, last_month, maximum) ou date_debut + date_fin (AAAA-MM-JJ).",
    parameters: {
      type: "object",
      properties: {
        compte: { type: "string", description: "Nom ou id du compte publicitaire (défaut : le compte actif)" },
        niveau: { type: "string", enum: ["campagne", "ensemble", "publicite"] },
        periode: { type: "string" },
        date_debut: { type: "string" },
        date_fin: { type: "string" },
      },
    },
  },
  {
    name: "meta_creatifs",
    label: "🎨 Créatifs Meta Ads",
    description: "Liste les publicités et leurs créatifs (titre, texte, CTA, format, aperçu) pour analyser les messages et les hooks.",
    parameters: {
      type: "object",
      properties: { compte: { type: "string" }, max: { type: "number" }, actives_seulement: { type: "boolean", description: "Défaut : true" } },
    },
  },
  {
    name: "meta_pages",
    label: "📄 Pages connectées",
    description: "Liste les pages Facebook connectées à MARKOVA (nom, id, abonnés, catégorie) et le compte Instagram pro relié à chacune. À appeler quand l'utilisateur demande ses pages, ou avant d'en choisir une.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "facebook_publications",
    label: "👍 Publications Facebook",
    description: "Publications récentes d'une page Facebook : texte, type, réactions, commentaires, partages et portée (si autorisée).",
    parameters: { type: "object", properties: { page: { type: "string", description: "Nom de la page (défaut : la première)" }, max: { type: "number" } } },
  },
  {
    name: "facebook_statistiques",
    label: "📈 Statistiques de page",
    description: "Statistiques d'une page Facebook sur N jours : portée, interactions, vues de la page, nouveaux abonnés, jour par jour.",
    parameters: { type: "object", properties: { page: { type: "string" }, jours: { type: "number", description: "1–90, défaut 28" } } },
  },
  {
    name: "instagram_publications",
    label: "📸 Publications Instagram",
    description: "Profil Instagram professionnel (abonnés) et publications récentes avec likes, commentaires, portée, vues, enregistrements, partages.",
    parameters: { type: "object", properties: { compte: { type: "string", description: "@nom du compte (défaut : le premier)" }, max: { type: "number" } } },
  },
  {
    name: "meta_demographie",
    label: "👥 Données démographiques",
    description:
      "Qui est ton audience. source « pubs » (défaut) : statistiques des publicités ventilées par repartition = age_sexe | pays | region | plateforme, avec dépenses, CTR, CPC, leads, CPL, achats, CPA par segment (filtre optionnel « campagne », période comme meta_performances) — c'est la meilleure base pour affiner un ciblage. " +
      "source « instagram » : abonnés par âge, sexe, pays, ville. source « facebook » : non fourni par Meta.",
    parameters: {
      type: "object",
      properties: {
        source: { type: "string", enum: ["pubs", "instagram", "facebook"] },
        repartition: { type: "string", enum: Object.keys(BREAKDOWNS) },
        compte: { type: "string", description: "Compte publicitaire (défaut : actif)" },
        campagne: { type: "string", description: "Texte contenu dans le nom des campagnes à analyser" },
        compte_instagram: { type: "string" },
        periode: { type: "string" },
        date_debut: { type: "string" },
        date_fin: { type: "string" },
      },
    },
  },
  {
    name: "meta_audiences",
    label: "🎯 Audiences Meta",
    description: "Liste les audiences personnalisées et similaires du compte publicitaire (id, type, taille), les pixels et les pages utilisables comme source. À appeler avant de proposer une nouvelle audience.",
    parameters: { type: "object", properties: { compte: { type: "string" } } },
  },
  {
    name: "meta_interets",
    label: "🔎 Centres d'intérêt Meta",
    description: "Cherche les centres d'intérêt ciblables dans Meta Ads (nom exact, id, taille estimée) pour construire un ciblage par intérêts.",
    parameters: { type: "object", properties: { recherche: { type: "string" } }, required: ["recherche"] },
  },
];

export async function runMetaTool(s: MetaSession, name: string, args: Record<string, unknown>): Promise<string | null> {
  switch (name) {
    case "meta_comptes_pub":
      return listAccounts(s);
    case "meta_performances":
      return performances(s, args);
    case "meta_creatifs":
      return creatives(s, args);
    case "meta_pages":
      return listPages(s);
    case "facebook_publications":
      return facebookPosts(s, args);
    case "facebook_statistiques":
      return pageInsights(s, args);
    case "instagram_publications":
      return instagramPosts(s, args);
    case "meta_demographie":
      return demographics(s, args);
    case "meta_audiences":
      return listAudiences(s, args);
    case "meta_interets":
      return searchInterests(s, args);
    default:
      return null;
  }
}

// ─── Actions validées ────────────────────────────────────────────
export const META_ACTION_KINDS = [
  "meta_pause",
  "meta_activer",
  "meta_budget",
  "meta_audience_similaire",
  "meta_audience_engagement",
  "meta_audience_site",
] as const;

type MetaObject = { id: string; name: string; effective_status: string; daily_budget?: string; account_id?: string };

async function metaObject(s: MetaSession, id: string) {
  return graph<MetaObject>(id, s.token, { fields: "id,name,effective_status,daily_budget,account_id" });
}

const clampInt = (v: unknown, min: number, max: number, def: number) => {
  const x = Math.round(Number(v));
  return Number.isFinite(x) ? Math.min(Math.max(x, min), max) : def;
};

/**
 * Création d'audience : vérifie les sources auprès de Meta et fige les paramètres exacts
 * (compte, page, ids) pour que l'exécution fasse exactement ce que l'utilisateur a validé.
 */
async function prepareAudience(s: MetaSession, kind: string, params: Record<string, unknown>) {
  const account = await resolveAccount(s, params.compte);
  const base = { compte_id: account.id };

  if (kind === "meta_audience_similaire") {
    const source = await graph<CustomAudience>(String(params.audience_source_id ?? ""), s.token, { fields: "id,name,approximate_count_lower_bound" }).catch(() => null);
    if (!source) throw new Error("audience_source_id introuvable : relis les audiences avec meta_audiences");
    const country = String(params.pays ?? "").trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(country)) throw new Error("pays : code à 2 lettres (MG, FR, CA…)");
    const pct = clampInt(params.pourcentage, 1, 10, 1);
    const name = String(params.nom ?? "").trim() || `Similaire ${pct} % ${country} — ${source.name}`;
    return {
      summary: `Créer l'audience similaire « ${name} » : ${pct} % des personnes de ${country} les plus proches de « ${source.name} » (compte ${account.name})`,
      params: { ...base, audience_source_id: source.id, pays: country, pourcentage: pct, nom: name },
    };
  }

  if (kind === "meta_audience_engagement") {
    const instagram = params.source === "instagram";
    const page = await pickPage(s, params.page);
    if (instagram && !page.instagram_business_account) throw new Error(`la page ${page.name} n'a pas de compte Instagram pro relié`);
    const days = clampInt(params.jours, 1, 365, 90);
    const label = instagram ? `Instagram @${page.instagram_business_account!.username ?? ""}` : `page Facebook ${page.name}`;
    const name = String(params.nom ?? "").trim() || `Engagement ${instagram ? "Instagram" : "Facebook"} ${days} j — ${page.name}`;
    return {
      summary: `Créer l'audience « ${name} » : personnes ayant interagi avec ${label} ces ${days} derniers jours (compte ${account.name})`,
      params: { ...base, source: instagram ? "instagram" : "page", source_id: instagram ? page.instagram_business_account!.id : page.id, jours: days, nom: name },
    };
  }

  // meta_audience_site
  const pixel = await graph<{ id: string; name: string }>(String(params.pixel_id ?? ""), s.token, { fields: "id,name" }).catch(() => null);
  if (!pixel) throw new Error("pixel_id introuvable : relis les pixels avec meta_audiences");
  const days = clampInt(params.jours, 1, 180, 30);
  const contains = String(params.url_contient ?? "").trim();
  const name = String(params.nom ?? "").trim() || `Visiteurs du site ${days} j${contains ? ` — ${contains}` : ""}`;
  return {
    summary: `Créer l'audience « ${name} » : visiteurs du site${contains ? ` (pages contenant « ${contains} »)` : ""} ces ${days} derniers jours, pixel ${pixel.name} (compte ${account.name})`,
    params: { ...base, pixel_id: pixel.id, jours: days, url_contient: contains, nom: name },
  };
}

async function createAudience(s: MetaSession, kind: string, p: Record<string, unknown>) {
  const account = String(p.compte_id);
  const name = String(p.nom);
  let body: Record<string, string>;
  if (kind === "meta_audience_similaire") {
    body = {
      name,
      subtype: "LOOKALIKE",
      origin_audience_id: String(p.audience_source_id),
      lookalike_spec: JSON.stringify({ ratio: Number(p.pourcentage) / 100, country: String(p.pays) }),
    };
  } else if (kind === "meta_audience_engagement") {
    const instagram = p.source === "instagram";
    body = {
      name,
      prefill: "true",
      rule: JSON.stringify({
        inclusions: {
          operator: "or",
          rules: [
            {
              event_sources: [{ id: String(p.source_id), type: instagram ? "ig_business" : "page" }],
              retention_seconds: Number(p.jours) * 86_400,
              filter: { operator: "and", filters: [{ field: "event", operator: "eq", value: instagram ? "ig_business_profile_all" : "page_engaged" }] },
            },
          ],
        },
      }),
    };
  } else {
    const contains = String(p.url_contient ?? "");
    body = {
      name,
      prefill: "true",
      rule: JSON.stringify({
        inclusions: {
          operator: "or",
          rules: [
            {
              event_sources: [{ id: String(p.pixel_id), type: "pixel" }],
              retention_seconds: Number(p.jours) * 86_400,
              filter: contains
                ? { operator: "and", filters: [{ field: "url", operator: "i_contains", value: contains }] }
                : { operator: "and", filters: [{ field: "event", operator: "eq", value: "PageView" }] },
            },
          ],
        },
      }),
    };
  }
  const r = await graph<{ id: string }>(`${account}/customaudiences`, s.token, body, "POST");
  return `Audience « ${name} » créée (id ${r.id}). Meta met souvent quelques heures à la remplir avant qu'elle soit utilisable.`;
}

/**
 * Libellé fiable construit à partir des vraies données Meta (nom réel, budget actuel), et paramètres
 * définitifs à enregistrer (pour les audiences : compte et sources vérifiés).
 */
export async function prepareMetaAction(s: MetaSession, kind: string, params: Record<string, unknown>) {
  if (kind.startsWith("meta_audience_")) return prepareAudience(s, kind, params);
  return { summary: await describeMetaAction(s, kind, params), params };
}

async function describeMetaAction(s: MetaSession, kind: string, params: Record<string, unknown>) {
  const id = String(params.objet_id ?? "");
  if (!id) throw new Error("objet_id manquant");
  const o = await metaObject(s, id);
  if (kind === "meta_pause") return `Mettre en pause « ${o.name} » (actuellement ${o.effective_status})`;
  if (kind === "meta_activer") return `Réactiver « ${o.name} » (actuellement ${o.effective_status})`;
  const amount = Number(params.budget_quotidien);
  if (!(amount > 0)) throw new Error("budget_quotidien invalide");
  const before = o.daily_budget ? `${fmt(Number(o.daily_budget) / 100)}` : "aucun budget quotidien à ce niveau";
  return `Budget quotidien de « ${o.name} » : ${before} → ${fmt(amount)} (devise du compte)`;
}

export async function executeMetaAction(s: MetaSession, kind: string, params: Record<string, unknown>) {
  if (kind.startsWith("meta_audience_")) return createAudience(s, kind, params);
  const id = String(params.objet_id ?? "");
  if (kind === "meta_pause") {
    await graph(id, s.token, { status: "PAUSED" }, "POST");
    return "Mis en pause.";
  }
  if (kind === "meta_activer") {
    await graph(id, s.token, { status: "ACTIVE" }, "POST");
    return "Réactivé.";
  }
  if (kind === "meta_budget") {
    const cents = Math.round(Number(params.budget_quotidien) * 100);
    if (!(cents > 0)) throw new Error("budget_quotidien invalide");
    await graph(id, s.token, { daily_budget: String(cents) }, "POST");
    return `Budget quotidien fixé à ${fmt(cents / 100)}.`;
  }
  throw new Error(`Action Meta inconnue : ${kind}`);
}
