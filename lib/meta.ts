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
  "read_insights",
  "instagram_basic",
  "instagram_manage_insights",
];

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

export function metaAuthUrl(origin: string, state: string, app: MetaApp) {
  const p = new URLSearchParams({
    client_id: app.id,
    redirect_uri: `${origin}/api/meta/callback`,
    state,
    response_type: "code",
  });
  // « Facebook Login for Business » : les permissions sont définies dans une configuration (config_id).
  // Sans configuration : Facebook Login classique avec la liste des permissions.
  if (app.configId) p.set("config_id", app.configId);
  else p.set("scope", META_SCOPES.join(","));
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
    if (e?.code === 200 || e?.code === 10) throw new Error(`permission Meta manquante : ${e.message}`);
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
export type MetaSession = { name: string; token: string; selection?: MetaSelection };

export async function getMetaSession(supabase: SupabaseClient): Promise<MetaSession | null> {
  if (!process.env.TOKEN_ENCRYPTION_KEY) return null;
  const { data } = await supabase
    .from("integrations")
    .select("account_email, refresh_token_enc, settings")
    .eq("provider", "meta")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  try {
    return { name: data.account_email, token: decrypt(data.refresh_token_enc), selection: (data.settings as MetaSelection) ?? {} };
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

const PRESETS = ["today", "yesterday", "last_7d", "last_14d", "last_30d", "last_90d", "this_month", "last_month", "maximum"];

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

async function pickPage(s: MetaSession, wanted?: unknown) {
  const all = await pages(s);
  if (!all.length) throw new Error("aucune page Facebook accessible");
  const w = typeof wanted === "string" ? wanted.toLowerCase().trim() : "";
  return (w && all.find((p) => p.name.toLowerCase().includes(w) || p.instagram_business_account?.username?.toLowerCase().includes(w.replace(/^@/, "")))) || all[0];
}

async function facebookPosts(s: MetaSession, args: Record<string, unknown>) {
  const page = await pickPage(s, args.page);
  const r = await graph<{ data: { id: string; message?: string; created_time: string; permalink_url?: string; shares?: { count: number }; reactions?: { summary: { total_count: number } }; comments?: { summary: { total_count: number } } }[] }>(
    `${page.id}/posts`,
    page.access_token,
    { fields: "message,created_time,permalink_url,shares,reactions.summary(true).limit(0),comments.summary(true).limit(0)", limit: String(Math.min(Number(args.max ?? 15), 50)) },
  );
  const posts = r.data ?? [];
  if (!posts.length) return `Aucune publication récente sur ${page.name}.`;
  return (
    `Page Facebook « ${page.name} » — ${posts.length} publications récentes :\n` +
    posts
      .map(
        (p) =>
          `- ${p.created_time.slice(0, 10)} · réactions ${p.reactions?.summary.total_count ?? 0} · commentaires ${p.comments?.summary.total_count ?? 0} · partages ${p.shares?.count ?? 0}\n  ${(p.message ?? "(sans texte)").replace(/\s+/g, " ").slice(0, 300)}${p.permalink_url ? `\n  ${p.permalink_url}` : ""}`,
      )
      .join("\n")
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
    name: "facebook_publications",
    label: "👍 Publications Facebook",
    description: "Publications récentes d'une page Facebook avec réactions, commentaires et partages.",
    parameters: { type: "object", properties: { page: { type: "string", description: "Nom de la page (défaut : la première)" }, max: { type: "number" } } },
  },
  {
    name: "instagram_publications",
    label: "📸 Publications Instagram",
    description: "Profil Instagram professionnel (abonnés) et publications récentes avec likes, commentaires, portée, vues, enregistrements, partages.",
    parameters: { type: "object", properties: { compte: { type: "string", description: "@nom du compte (défaut : le premier)" }, max: { type: "number" } } },
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
    case "facebook_publications":
      return facebookPosts(s, args);
    case "instagram_publications":
      return instagramPosts(s, args);
    default:
      return null;
  }
}

// ─── Actions validées ────────────────────────────────────────────
export const META_ACTION_KINDS = ["meta_pause", "meta_activer", "meta_budget"] as const;

type MetaObject = { id: string; name: string; effective_status: string; daily_budget?: string; account_id?: string };

async function metaObject(s: MetaSession, id: string) {
  return graph<MetaObject>(id, s.token, { fields: "id,name,effective_status,daily_budget,account_id" });
}

/** Libellé fiable construit à partir des vraies données Meta (nom réel, budget actuel). */
export async function describeMetaAction(s: MetaSession, kind: string, params: Record<string, unknown>) {
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
