import type { SupabaseClient } from "@supabase/supabase-js";
import { decrypt, encrypt } from "./crypto";
import { detectKind, extractContent } from "./files";

// Lecture seule pour Gmail, Agenda et Drive. Google Tasks et Google Sheets en écriture : les modifications
// ne sont faites qu'après validation de l'utilisateur (table « actions »).
export const TASKS_WRITE_SCOPE = "https://www.googleapis.com/auth/tasks";
export const SHEETS_WRITE_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
/** Autorisations d'écriture à redemander aux comptes connectés avant leur ajout. */
export const WRITE_SCOPES = [TASKS_WRITE_SCOPE, SHEETS_WRITE_SCOPE];
export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/drive.readonly",
  ...WRITE_SCOPES,
];

// ─── Clients OAuth ───────────────────────────────────────────────
// Un client OAuth par projet Google Cloud : GOOGLE_CLIENT_ID_1 / GOOGLE_CLIENT_SECRET_1, _2, … _5.
// (GOOGLE_CLIENT_ID sans suffixe est accepté comme client 1.)
// GOOGLE_CLIENT_HINT_n (optionnel) = l'adresse prévue pour ce client : affichée sur le bouton et pré-remplie chez Google.
export type GoogleClient = { slot: string; id: string; secret: string; hint?: string };

export function googleClients(): GoogleClient[] {
  const clients: GoogleClient[] = [];
  for (let i = 1; i <= 5; i++) {
    const id = process.env[`GOOGLE_CLIENT_ID_${i}`] ?? (i === 1 ? process.env.GOOGLE_CLIENT_ID : undefined);
    const secret = process.env[`GOOGLE_CLIENT_SECRET_${i}`] ?? (i === 1 ? process.env.GOOGLE_CLIENT_SECRET : undefined);
    if (id && secret) clients.push({ slot: String(i), id, secret, hint: process.env[`GOOGLE_CLIENT_HINT_${i}`] || undefined });
  }
  return clients;
}

export const googleClient = (slot: string) => googleClients().find((c) => c.slot === slot) ?? null;

export const googleConfigured = () => googleClients().length > 0 && Boolean(process.env.TOKEN_ENCRYPTION_KEY);

export const redirectUri = (origin: string) => `${origin}/api/google/callback`;

export function authUrl(origin: string, state: string, client: GoogleClient) {
  const p = new URLSearchParams({
    client_id: client.id,
    redirect_uri: redirectUri(origin),
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    // Toujours proposer le choix du compte : permet d'ajouter un 2e mail avec le même bouton.
    prompt: "select_account consent",
    include_granted_scopes: "true",
    state,
  });
  if (client.hint) p.set("login_hint", client.hint);
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

type TokenResponse = { access_token: string; expires_in: number; refresh_token?: string; scope?: string; id_token?: string; error?: string; error_description?: string };

async function tokenRequest(client: GoogleClient, params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: client.id, client_secret: client.secret, ...params }),
  });
  const json = (await res.json()) as TokenResponse;
  if (!res.ok) {
    if (json.error === "invalid_grant") throw new Error("accès Google expiré ou révoqué — reconnecte ce compte dans Connexions");
    throw new Error(json.error_description ?? json.error ?? `OAuth HTTP ${res.status}`);
  }
  return json;
}

export async function exchangeCode(code: string, origin: string, client: GoogleClient) {
  return tokenRequest(client, { code, grant_type: "authorization_code", redirect_uri: redirectUri(origin) });
}

export async function revokeToken(token: string) {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: "POST" }).catch(() => {});
}

export { encrypt as encryptToken };

// ─── Comptes Google connectés ────────────────────────────────────
export type GoogleSession = { email: string; timezone: string; token: () => Promise<string> };

const accessCache = new Map<string, { token: string; exp: number }>();

/**
 * Tous les comptes Google connectés de l'utilisateur (chacun avec son client OAuth).
 * timezone : fuseau de l'appareil de l'utilisateur (prioritaire sur celui de l'agenda Google).
 * userId : obligatoire avec le client « service » des tâches planifiées (pas de RLS).
 */
export async function getGoogleSessions(supabase: SupabaseClient, opts: { timezone?: string; userId?: string } = {}): Promise<GoogleSession[]> {
  if (!googleConfigured()) return [];
  const q = supabase
    .from("integrations")
    .select("id, client_slot, account_email, refresh_token_enc, timezone")
    .eq("provider", "google")
    .order("created_at");
  const { data } = await (opts.userId ? q.eq("user_id", opts.userId) : q);

  return (data ?? []).flatMap((row) => {
    const client = googleClient(row.client_slot);
    if (!client) return [];
    return [
      {
        email: row.account_email as string,
        timezone: opts.timezone || row.timezone || "Europe/Paris",
        token: async () => {
          // Clé liée au jeton de rafraîchissement : après « Mettre à jour les autorisations »,
          // l'ancien jeton d'accès (sans les nouveaux droits) n'est plus réutilisé.
          const key = `${row.id}:${String(row.refresh_token_enc).slice(-24)}`;
          const cached = accessCache.get(key);
          if (cached && cached.exp > Date.now() + 60_000) return cached.token;
          const t = await tokenRequest(client, { refresh_token: decrypt(row.refresh_token_enc), grant_type: "refresh_token" });
          accessCache.set(key, { token: t.access_token, exp: Date.now() + t.expires_in * 1000 });
          return t.access_token;
        },
      },
    ];
  });
}

async function gget<T>(s: GoogleSession, url: string): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${await s.token()}` } });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

async function gbytes(s: GoogleSession, url: string): Promise<Uint8Array> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${await s.token()}` } });
  if (!res.ok) throw new Error(`Google HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

export async function fetchTimezone(accessToken: string) {
  const res = await fetch("https://www.googleapis.com/calendar/v3/users/me/settings/timezone", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  return ((await res.json()) as { value?: string }).value ?? null;
}

// ─── Dates dans le fuseau de l'utilisateur ───────────────────────
/** Décalage « +03:00 » d'un fuseau à une date donnée. */
function offsetOf(tz: string, at: Date) {
  const part = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" })
    .formatToParts(at)
    .find((p) => p.type === "timeZoneName")?.value;
  const m = part?.match(/GMT([+-]\d{2}:\d{2})/);
  return m ? m[1] : "+00:00";
}

/** Date du jour AAAA-MM-JJ dans le fuseau. */
export function todayIn(tz: string, shiftDays = 0) {
  const d = new Date(Date.now() + shiftDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

function dayBoundary(date: string, tz: string, end: boolean) {
  const time = end ? "23:59:59" : "00:00:00";
  return `${date}T${time}${offsetOf(tz, new Date(`${date}T12:00:00Z`))}`;
}

function fmtDateTime(iso: string | undefined, tz: string) {
  if (!iso) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return `${iso} (journée entière)`;
  return new Intl.DateTimeFormat("fr-FR", { timeZone: tz, weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

// ─── Agenda ──────────────────────────────────────────────────────
type GEvent = {
  summary?: string;
  description?: string;
  location?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: { email: string; responseStatus?: string }[];
  htmlLink?: string;
  status?: string;
};

async function listEvents(s: GoogleSession, args: { date_debut?: string; date_fin?: string; recherche?: string }) {
  const start = args.date_debut || todayIn(s.timezone);
  const end = args.date_fin || start;
  const calendars = await gget<{ items: { id: string; summary: string; selected?: boolean; primary?: boolean }[] }>(
    s,
    "https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader",
  );
  const targets = calendars.items.filter((c) => c.primary || c.selected);
  const all: string[] = [];
  for (const cal of targets.slice(0, 10)) {
    const p = new URLSearchParams({
      timeMin: dayBoundary(start, s.timezone, false),
      timeMax: dayBoundary(end, s.timezone, true),
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "100",
      timeZone: s.timezone,
    });
    if (args.recherche) p.set("q", args.recherche);
    const { items } = await gget<{ items: GEvent[] }>(
      s,
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events?${p}`,
    );
    for (const e of items ?? []) {
      if (e.status === "cancelled") continue;
      all.push(
        [
          `- ${fmtDateTime(e.start?.dateTime ?? e.start?.date, s.timezone)} → ${fmtDateTime(e.end?.dateTime ?? e.end?.date, s.timezone)} : **${e.summary ?? "(sans titre)"}**`,
          targets.length > 1 ? `  agenda : ${cal.summary}` : "",
          e.location ? `  lieu : ${e.location}` : "",
          e.attendees?.length ? `  participants : ${e.attendees.map((a) => a.email).slice(0, 10).join(", ")}` : "",
          e.description ? `  description : ${e.description.replace(/<[^>]+>/g, " ").slice(0, 300)}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      );
    }
  }
  return all.length ? `Événements du ${start} au ${end} (fuseau ${s.timezone}) :\n${all.join("\n")}` : `Aucun événement du ${start} au ${end}.`;
}

// ─── Gmail ───────────────────────────────────────────────────────
type GmailPart = { mimeType?: string; body?: { data?: string; size?: number }; parts?: GmailPart[]; filename?: string };
type GmailMessage = { id: string; threadId: string; snippet?: string; labelIds?: string[]; payload?: GmailPart & { headers?: { name: string; value: string }[] } };

const header = (m: GmailMessage, name: string) => m.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
const b64url = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");

async function searchEmails(s: GoogleSession, args: { requete?: string; max?: number }) {
  const q = args.requete || "newer_than:1d";
  const max = Math.min(Math.max(args.max ?? 15, 1), 30);
  const list = await gget<{ messages?: { id: string }[] }>(
    s,
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?${new URLSearchParams({ q, maxResults: String(max) })}`,
  );
  if (!list.messages?.length) return `Aucun email pour la recherche « ${q} ».`;
  const metas = await Promise.all(
    list.messages.map((m) =>
      gget<GmailMessage>(
        s,
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
      ),
    ),
  );
  return (
    `${metas.length} email(s) pour « ${q} » :\n` +
    metas
      .map(
        (m) =>
          `- id=${m.id}${m.labelIds?.includes("UNREAD") ? " · NON LU" : ""}${m.labelIds?.includes("IMPORTANT") ? " · important" : ""}\n` +
          `  de : ${header(m, "From")}\n  objet : ${header(m, "Subject")}\n  date : ${header(m, "Date")}\n  aperçu : ${m.snippet ?? ""}`,
      )
      .join("\n")
  );
}

function bodyText(part: GmailPart | undefined): { text: string; html: string; attachments: string[] } {
  const out = { text: "", html: "", attachments: [] as string[] };
  const walk = (p?: GmailPart) => {
    if (!p) return;
    if (p.filename) out.attachments.push(p.filename);
    else if (p.mimeType === "text/plain" && p.body?.data) out.text += b64url(p.body.data);
    else if (p.mimeType === "text/html" && p.body?.data) out.html += b64url(p.body.data);
    p.parts?.forEach(walk);
  };
  walk(part);
  return out;
}

async function readEmail(s: GoogleSession, args: { id: string }) {
  const m = await gget<GmailMessage>(s, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(args.id)}?format=full`);
  const b = bodyText(m.payload);
  const text =
    b.text ||
    b.html
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/\s{2,}/g, " ");
  return [
    `de : ${header(m, "From")}`,
    `à : ${header(m, "To")}`,
    `objet : ${header(m, "Subject")}`,
    `date : ${header(m, "Date")}`,
    b.attachments.length ? `pièces jointes : ${b.attachments.join(", ")}` : "",
  ]
    .filter(Boolean)
    .concat("", text.trim().slice(0, 10_000))
    .join("\n");
}

// ─── Drive ───────────────────────────────────────────────────────
type DriveFile = { id: string; name: string; mimeType: string; modifiedTime: string; webViewLink?: string; size?: string; owners?: { displayName: string }[] };

async function searchDrive(s: GoogleSession, args: { recherche?: string; max?: number }) {
  const esc = (x: string) => x.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const q = args.recherche
    ? `(name contains '${esc(args.recherche)}' or fullText contains '${esc(args.recherche)}') and trashed = false`
    : "trashed = false";
  const p = new URLSearchParams({
    q,
    pageSize: String(Math.min(args.max ?? 15, 30)),
    fields: "files(id,name,mimeType,modifiedTime,webViewLink,size,owners(displayName))",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });
  // Drive refuse orderBy avec une recherche plein texte.
  if (!args.recherche) p.set("orderBy", "modifiedTime desc");
  const { files } = await gget<{ files: DriveFile[] }>(s, `https://www.googleapis.com/drive/v3/files?${p}`);
  if (!files?.length) return `Aucun fichier Drive${args.recherche ? ` pour « ${args.recherche} »` : ""}.`;
  return files
    .map((f) => `- id=${f.id} · **${f.name}** · ${f.mimeType.replace("application/vnd.google-apps.", "google-")} · modifié ${f.modifiedTime.slice(0, 10)}${f.webViewLink ? ` · ${f.webViewLink}` : ""}`)
    .join("\n");
}

const EXPORTS: Record<string, { mime: string; ext: string }> = {
  "application/vnd.google-apps.document": { mime: "text/plain", ext: "txt" },
  "application/vnd.google-apps.spreadsheet": { mime: "text/csv", ext: "csv" },
  "application/vnd.google-apps.presentation": { mime: "text/plain", ext: "txt" },
};

async function readDriveFile(s: GoogleSession, args: { id: string }) {
  const f = await gget<DriveFile>(s, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(args.id)}?fields=id,name,mimeType,size&supportsAllDrives=true`);
  const exp = EXPORTS[f.mimeType];
  let bytes: Uint8Array;
  let name = f.name;
  if (exp) {
    bytes = await gbytes(s, `https://www.googleapis.com/drive/v3/files/${f.id}/export?mimeType=${encodeURIComponent(exp.mime)}`);
    name = `${f.name}.${exp.ext}`;
  } else {
    if (Number(f.size ?? 0) > 20 * 1024 * 1024) return `Fichier « ${f.name} » trop volumineux pour être lu (> 20 Mo).`;
    bytes = await gbytes(s, `https://www.googleapis.com/drive/v3/files/${f.id}?alt=media&supportsAllDrives=true`);
  }
  const kind = detectKind(name, exp?.mime ?? f.mimeType);
  if (kind === "image" || kind === "autre") return `Fichier « ${f.name} » (${f.mimeType}) : format non lisible en texte.`;
  const r = await extractContent(name, kind, bytes);
  return [`Fichier Drive « ${f.name} »`, r.kpi, r.text?.slice(0, 60_000), r.note].filter(Boolean).join("\n\n");
}

// ─── Tâches ──────────────────────────────────────────────────────
type GTask = { id: string; title?: string; notes?: string; due?: string; status?: string; updated?: string };

async function listTasks(s: GoogleSession, args: { inclure_terminees?: boolean }) {
  const { items: lists } = await gget<{ items?: { id: string; title: string }[] }>(s, "https://tasks.googleapis.com/tasks/v1/users/@me/lists?maxResults=20");
  if (!lists?.length) return "Aucune liste de tâches Google.";
  const today = todayIn(s.timezone);
  const out: string[] = [];
  for (const l of lists) {
    const p = new URLSearchParams({ maxResults: "100", showCompleted: String(Boolean(args.inclure_terminees)), showHidden: "false" });
    const { items } = await gget<{ items?: GTask[] }>(s, `https://tasks.googleapis.com/tasks/v1/lists/${l.id}/tasks?${p}`);
    if (!items?.length) continue;
    out.push(`### ${l.title} (liste_id=${l.id})`);
    for (const t of items) {
      const due = t.due?.slice(0, 10);
      const flag = due ? (due < today ? " · EN RETARD" : due === today ? " · AUJOURD'HUI" : "") : "";
      out.push(
        `- ${t.status === "completed" ? "✓ " : ""}${t.title ?? "(sans titre)"}${due ? ` · échéance ${due}` : ""}${flag} · tache_id=${t.id}` +
          (t.notes ? `\n  notes : ${t.notes.slice(0, 200)}` : ""),
      );
    }
  }
  return out.length ? out.join("\n") : "Aucune tâche en cours.";
}

/** Titres des tâches en retard, du jour et de demain (surveillance automatique). */
export async function taskDeadlines(s: GoogleSession) {
  const { items: lists } = await gget<{ items?: { id: string }[] }>(s, "https://tasks.googleapis.com/tasks/v1/users/@me/lists?maxResults=20");
  const today = todayIn(s.timezone);
  const tomorrow = todayIn(s.timezone, 1);
  const out = { enRetard: [] as string[], aujourdhui: [] as string[], demain: [] as string[] };
  for (const l of lists ?? []) {
    const { items } = await gget<{ items?: GTask[] }>(s, `https://tasks.googleapis.com/tasks/v1/lists/${l.id}/tasks?maxResults=100&showCompleted=false`);
    for (const t of items ?? []) {
      const due = t.due?.slice(0, 10);
      const title = t.title || "(sans titre)";
      if (!due) continue;
      if (due < today) out.enRetard.push(title);
      else if (due === today) out.aujourdhui.push(title);
      else if (due === tomorrow) out.demain.push(title);
    }
  }
  return out;
}

// ─── Actions validées (écriture) ─────────────────────────────────
export const ACTION_KINDS = ["tache_supprimer", "tache_terminer", "tache_creer", "sheets_ajouter_lignes", "sheets_ecrire", "sheets_creer"] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

async function gsend<T = unknown>(s: GoogleSession, method: string, url: string, body?: unknown): Promise<T | null> {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${await s.token()}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 403 && /insufficient/i.test(await res.clone().text())) {
    throw new Error("droits insuffisants : dans Connexions, clique sur « Mettre à jour les autorisations » pour ce compte");
  }
  if (!res.ok && res.status !== 204) throw new Error(`Google HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
  return res.status === 204 ? null : ((await res.json().catch(() => null)) as T | null);
}

// ─── Google Sheets ───────────────────────────────────────────────
const MAX_SHEET_ROWS = 1000;

/** Lignes envoyées par l'agent → tableau de lignes de valeurs simples (texte, nombre, booléen). */
function sheetRows(raw: unknown): (string | number | boolean)[][] {
  if (!Array.isArray(raw) || !raw.length) throw new Error("« lignes » doit être un tableau de lignes, ex. [[\"Date\", \"CPL\"], [\"2026-09-29\", 12.4]]");
  if (raw.length > MAX_SHEET_ROWS) throw new Error(`trop de lignes (max ${MAX_SHEET_ROWS})`);
  return raw.map((row) =>
    (Array.isArray(row) ? row : [row]).map((v) => (typeof v === "number" || typeof v === "boolean" ? v : v == null ? "" : String(v))),
  );
}

const sheetRange = (params: Record<string, unknown>, fallback: string) => {
  const tab = typeof params.feuille === "string" && params.feuille.trim() ? `'${params.feuille.replace(/'/g, "''")}'!` : "";
  const range = typeof params.plage === "string" && params.plage.trim() ? params.plage.trim() : fallback;
  return range.includes("!") ? range : `${tab}${range}`;
};

const preview = (rows: (string | number | boolean)[][]) =>
  rows.slice(0, 2).map((r) => r.slice(0, 6).join(" | ")).join(" / ") + (rows.length > 2 ? " / …" : "");

async function sheetTitle(s: GoogleSession, id: unknown) {
  if (typeof id !== "string" || !id) throw new Error("fichier_id manquant (id Drive du tableur)");
  const f = await gget<DriveFile>(s, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=id,name,mimeType&supportsAllDrives=true`);
  if (f.mimeType !== "application/vnd.google-apps.spreadsheet") throw new Error(`« ${f.name} » n'est pas un Google Sheets`);
  return f.name;
}

/**
 * Résumé fiable d'une action, construit à partir des vraies données Google (titre réel de la tâche)
 * plutôt que du texte écrit par l'IA : l'utilisateur voit exactement ce qui sera modifié.
 */
export async function describeAction(s: GoogleSession, kind: string, params: Record<string, unknown>): Promise<string> {
  if (kind === "sheets_creer") {
    const rows = params.lignes ? sheetRows(params.lignes) : [];
    return `Créer le Google Sheets « ${String(params.titre ?? "Sans titre")} »${rows.length ? ` avec ${rows.length} ligne(s) : ${preview(rows)}` : ""}`;
  }
  if (kind === "sheets_ajouter_lignes" || kind === "sheets_ecrire") {
    const title = await sheetTitle(s, params.fichier_id);
    const rows = sheetRows(params.lignes);
    return kind === "sheets_ajouter_lignes"
      ? `Ajouter ${rows.length} ligne(s) à la fin de « ${title} »${params.feuille ? ` (onglet ${params.feuille})` : ""} : ${preview(rows)}`
      : `Écrire ${rows.length} ligne(s) dans « ${title} », plage ${sheetRange(params, "A1")} (remplace le contenu) : ${preview(rows)}`;
  }
  if (kind === "tache_creer") {
    const due = typeof params.echeance === "string" ? ` · échéance ${params.echeance}` : "";
    return `Créer la tâche « ${String(params.titre ?? "")} »${due}`;
  }
  const list = encodeURIComponent(String(params.liste_id || "@default"));
  const task = encodeURIComponent(String(params.tache_id ?? ""));
  const t = await gget<GTask>(s, `https://tasks.googleapis.com/tasks/v1/lists/${list}/tasks/${task}`);
  const verb = kind === "tache_supprimer" ? "Supprimer" : "Marquer comme terminée";
  return `${verb} la tâche « ${t.title ?? "(sans titre)"} »${t.due ? ` · échéance ${t.due.slice(0, 10)}` : ""}`;
}

/** Exécute une action validée par l'utilisateur. Renvoie un résumé du résultat. */
export async function executeGoogleAction(s: GoogleSession, kind: string, params: Record<string, unknown>): Promise<string> {
  const list = encodeURIComponent(String(params.liste_id || "@default"));
  const task = encodeURIComponent(String(params.tache_id ?? ""));
  switch (kind) {
    case "tache_supprimer":
      if (!params.tache_id) throw new Error("tache_id manquant");
      await gsend(s, "DELETE", `https://tasks.googleapis.com/tasks/v1/lists/${list}/tasks/${task}`);
      return "Tâche supprimée.";
    case "tache_terminer":
      if (!params.tache_id) throw new Error("tache_id manquant");
      await gsend(s, "PATCH", `https://tasks.googleapis.com/tasks/v1/lists/${list}/tasks/${task}`, { status: "completed" });
      return "Tâche marquée comme terminée.";
    case "tache_creer": {
      if (!params.titre) throw new Error("titre manquant");
      const due = typeof params.echeance === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.echeance) ? `${params.echeance}T00:00:00.000Z` : undefined;
      await gsend(s, "POST", `https://tasks.googleapis.com/tasks/v1/lists/${list}/tasks`, { title: params.titre, notes: params.notes, due });
      return "Tâche créée.";
    }
    case "sheets_ajouter_lignes": {
      const id = encodeURIComponent(String(params.fichier_id ?? ""));
      const range = encodeURIComponent(sheetRange(params, "A1"));
      const r = await gsend<{ updates?: { updatedRows?: number; updatedRange?: string } }>(
        s,
        "POST",
        `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
        { values: sheetRows(params.lignes) },
      );
      return `${r?.updates?.updatedRows ?? "?"} ligne(s) ajoutée(s) (${r?.updates?.updatedRange ?? ""}).`;
    }
    case "sheets_ecrire": {
      const id = encodeURIComponent(String(params.fichier_id ?? ""));
      const range = encodeURIComponent(sheetRange(params, "A1"));
      const r = await gsend<{ updatedCells?: number; updatedRange?: string }>(
        s,
        "PUT",
        `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${range}?valueInputOption=USER_ENTERED`,
        { values: sheetRows(params.lignes) },
      );
      return `${r?.updatedCells ?? "?"} cellule(s) écrite(s) (${r?.updatedRange ?? ""}).`;
    }
    case "sheets_creer": {
      const tab = typeof params.feuille === "string" && params.feuille.trim() ? params.feuille.trim() : "Feuille 1";
      const created = await gsend<{ spreadsheetId: string; spreadsheetUrl: string }>(s, "POST", "https://sheets.googleapis.com/v4/spreadsheets", {
        properties: { title: String(params.titre ?? "MARKOVA") },
        sheets: [{ properties: { title: tab } }],
      });
      if (!created) throw new Error("création refusée par Google");
      if (params.lignes) {
        await gsend(
          s,
          "PUT",
          `https://sheets.googleapis.com/v4/spreadsheets/${created.spreadsheetId}/values/${encodeURIComponent(`'${tab.replace(/'/g, "''")}'!A1`)}?valueInputOption=USER_ENTERED`,
          { values: sheetRows(params.lignes) },
        );
      }
      return `Google Sheets créé : ${created.spreadsheetUrl}`;
    }
    default:
      throw new Error(`Type d'action non pris en charge : ${kind}`);
  }
}

// ─── Déclaration des outils pour l'agent ─────────────────────────
export type ToolDef = { name: string; label: string; description: string; parameters: Record<string, unknown> };

export const GOOGLE_TOOLS: ToolDef[] = [
  {
    name: "agenda_evenements",
    label: "📅 Lecture de l'agenda",
    description: "Liste les événements Google Agenda entre deux dates (incluses). Sans date : aujourd'hui.",
    parameters: {
      type: "object",
      properties: {
        date_debut: { type: "string", description: "AAAA-MM-JJ" },
        date_fin: { type: "string", description: "AAAA-MM-JJ" },
        recherche: { type: "string", description: "Mot-clé optionnel dans les événements" },
      },
    },
  },
  {
    name: "gmail_rechercher",
    label: "✉️ Recherche dans Gmail",
    description:
      "Recherche des emails avec la syntaxe Gmail (ex. « newer_than:1d », « is:unread newer_than:3d », « from:meta.com », « subject:facture after:2026/09/01 »). Renvoie expéditeur, objet, date, aperçu et id.",
    parameters: {
      type: "object",
      properties: {
        requete: { type: "string", description: "Requête Gmail. Défaut : newer_than:1d" },
        max: { type: "number", description: "Nombre maximum (1–30, défaut 15)" },
      },
    },
  },
  {
    name: "gmail_lire",
    label: "✉️ Lecture d'un email",
    description: "Lit le contenu complet d'un email à partir de son id (obtenu via gmail_rechercher).",
    parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "drive_rechercher",
    label: "📁 Recherche dans Drive",
    description: "Recherche des fichiers Google Drive par nom ou contenu. Sans recherche : fichiers récemment modifiés.",
    parameters: {
      type: "object",
      properties: { recherche: { type: "string" }, max: { type: "number", description: "1–30, défaut 15" } },
    },
  },
  {
    name: "drive_lire",
    label: "📄 Lecture d'un fichier Drive",
    description: "Lit le contenu d'un fichier Drive (Docs, Sheets, Slides, PDF, DOCX, XLSX, CSV, TXT) à partir de son id. Calcule les KPI si c'est un export publicitaire.",
    parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "taches_lister",
    label: "✅ Lecture des tâches",
    description: "Liste les tâches Google Tasks non terminées, avec échéances et retards.",
    parameters: { type: "object", properties: { inclure_terminees: { type: "boolean" } } },
  },
];

/** Ajoute le paramètre « compte » à chaque outil quand plusieurs comptes sont connectés. */
export function googleToolDefs(sessions: GoogleSession[]): ToolDef[] {
  if (sessions.length < 2) return GOOGLE_TOOLS;
  const emails = sessions.map((s) => s.email);
  return GOOGLE_TOOLS.map((t) => {
    const params = t.parameters as { properties: Record<string, unknown>; required?: string[] };
    const isRead = READ_TOOLS.has(t.name);
    return {
      ...t,
      parameters: {
        ...params,
        properties: {
          ...params.properties,
          compte: {
            type: "string",
            enum: emails,
            description: isRead
              ? "Compte où se trouve l'élément (indiqué dans le résultat de la recherche)."
              : "Optionnel : limiter à un compte. Sans valeur : tous les comptes.",
          },
        },
        required: isRead ? [...(params.required ?? []), "compte"] : params.required,
      },
    };
  });
}

const READ_TOOLS = new Set(["gmail_lire", "drive_lire"]);

/**
 * Exécute un outil Google. Les recherches/listes couvrent tous les comptes (ou celui demandé) ;
 * les lectures d'un élément précis visent un seul compte.
 */
export async function runGoogleTool(sessions: GoogleSession[], name: string, args: Record<string, unknown>): Promise<string> {
  const wanted = typeof args.compte === "string" ? args.compte.toLowerCase() : null;
  const targets = wanted ? sessions.filter((s) => s.email.toLowerCase() === wanted) : sessions;
  if (!targets.length) return `Compte inconnu : ${args.compte}. Comptes connectés : ${sessions.map((s) => s.email).join(", ")}.`;

  if (READ_TOOLS.has(name)) {
    if (targets.length > 1) return `Précise le paramètre « compte » parmi : ${targets.map((s) => s.email).join(", ")}.`;
    return runOne(targets[0], name, args);
  }
  if (targets.length === 1) return runOne(targets[0], name, args);
  const parts = await Promise.all(
    targets.map(async (s) => {
      try {
        return `## Compte ${s.email}\n${await runOne(s, name, args)}`;
      } catch (err) {
        return `## Compte ${s.email}\nERREUR : ${err instanceof Error ? err.message : String(err)}`;
      }
    }),
  );
  return parts.join("\n\n");
}

async function runOne(s: GoogleSession, name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case "agenda_evenements":
      return listEvents(s, args as never);
    case "gmail_rechercher":
      return searchEmails(s, args as never);
    case "gmail_lire":
      return readEmail(s, args as never);
    case "drive_rechercher":
      return searchDrive(s, args as never);
    case "drive_lire":
      return readDriveFile(s, args as never);
    case "taches_lister":
      return listTasks(s, args as never);
    default:
      return `Outil inconnu : ${name}`;
  }
}
