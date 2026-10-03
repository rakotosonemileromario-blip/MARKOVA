import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generate, type ToolSet } from "./llm";
import { readWebPage } from "./webtools";
import { hasWebSearchProvider, searchWeb } from "./websearch";
import { notify } from "./notify";
import { loadSkills } from "./skills";
import { todayIn } from "./google";

// Veille concurrentielle automatique : les pages des concurrents (accueil, tarifs, offres) sont relues
// chaque jour ; quand leur contenu change, l'IA relève prix, offres, messages et nouveautés et les
// compare au relevé précédent. Changement de prix ou d'offre = alerte. Synthèse chaque lundi.
// Lecture seule : rien n'est publié ni modifié nulle part.

export type Facts = { prix: { produit: string; prix: string }[]; offres: string[]; messages: string[]; nouveautes: string[] };
export type Change = { type: "prix" | "offre" | "message" | "nouveaute"; detail: string };
export type Competitor = { id: string; user_id: string; project_id: string | null; name: string; urls: string[]; notes: string | null };
type Snapshot = { id: string; competitor_id: string; url: string; content_hash: string; facts: Facts; changes: Change[]; checked_at: string };

const CHANGE_TYPES = ["prix", "offre", "message", "nouveaute"] as const;
const PAGE_CHARS = 14_000;

const strings = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x ?? "").trim()).filter(Boolean).slice(0, 30) : []);

function cleanFacts(v: unknown): Facts {
  const o = (v ?? {}) as Record<string, unknown>;
  const prix = Array.isArray(o.prix)
    ? o.prix
        .map((p) => ({ produit: String((p as Record<string, unknown>)?.produit ?? "").trim(), prix: String((p as Record<string, unknown>)?.prix ?? "").trim() }))
        .filter((p) => p.prix)
        .slice(0, 40)
    : [];
  return { prix, offres: strings(o.offres), messages: strings(o.messages), nouveautes: strings(o.nouveautes) };
}

function cleanChanges(v: unknown): Change[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((c) => ({ type: String((c as Record<string, unknown>)?.type ?? ""), detail: String((c as Record<string, unknown>)?.detail ?? "").trim() }))
    .filter((c): c is Change => (CHANGE_TYPES as readonly string[]).includes(c.type) && Boolean(c.detail))
    .slice(0, 20);
}

/** Texte complet renvoyé par le modèle (sans outils). */
async function ask(system: string, text: string) {
  let out = "";
  for await (const ev of generate({ system, turns: [{ role: "user", text }], webSearch: false })) {
    if (ev.type === "text") out += ev.text;
  }
  return out;
}

function parseJson(raw: string): Record<string, unknown> {
  const body = raw.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1] ?? raw;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("réponse de l'IA illisible (pas de JSON)");
  return JSON.parse(body.slice(start, end + 1));
}

const EXTRACT_SYSTEM = `Tu es l'outil de veille concurrentielle de MARKOVA. On te donne le texte d'une page Web d'un concurrent et, s'il existe, le RELEVÉ PRÉCÉDENT de cette même page.
Réponds UNIQUEMENT par un objet JSON, sans texte autour :
{"prix": [{"produit": "…", "prix": "…"}], "offres": ["…"], "messages": ["…"], "nouveautes": ["…"]}
- prix : chaque prix affiché, avec le produit / la formule et l'unité, tels qu'écrits (« 49 €/mois », « dès 1 200 000 Ar »).
- offres : promotions, réductions, essais gratuits, codes promo, packs, garanties, conditions (avec dates limites si indiquées).
- messages : promesse principale, accroches et arguments mis en avant (5 max, courts).
- nouveautes : produits, services, fonctionnalités ou annonces présentés comme nouveaux.
- Rédige en français (traduis si la page est dans une autre langue), sauf les noms de produits et les prix.
- N'invente rien : seulement ce qui est écrit dans la page. Liste vide si rien.
- Si un relevé précédent est fourni, REPRENDS MOT POUR MOT les éléments qui sont toujours vrais.`;

const DIFF_SYSTEM = `Tu es l'outil de veille concurrentielle de MARKOVA. Une page d'un concurrent a changé. On te donne son RELEVÉ PRÉCÉDENT (JSON) et les LIGNES RETIRÉES et AJOUTÉES du texte de la page depuis la dernière lecture.
Réponds UNIQUEMENT par un objet JSON : {"changements": [{"type": "prix|offre|message|nouveaute", "detail": "…"}]}
- Seulement les changements commerciaux PROUVÉS par ces lignes : prix modifié, ajouté ou retiré ; offre / promotion / essai / code promo ajouté ou retiré ; nouvelle promesse ou accroche ; nouveau produit ou annonce.
- detail : en français, court, avec l'avant → après quand il existe (« Formule Pro : 49 € → 39 €/mois »).
- Ignore tout le reste : dates, compteurs, avis clients, articles de blog qui tournent, menus, cookies, mentions légales, mise en forme, lignes simplement déplacées.
- Rien de commercial : {"changements": []}.`;

/** Relevé d'une page par l'IA (prix, offres, messages, nouveautés). */
export async function extractFacts(name: string, url: string, page: string, prev: { facts: Facts; checked_at: string } | null) {
  const raw = await ask(
    EXTRACT_SYSTEM,
    `Concurrent : ${name}\nPage : ${url}\n\n` +
      (prev ? `RELEVÉ PRÉCÉDENT (${prev.checked_at.slice(0, 10)}) :\n${JSON.stringify(prev.facts)}\n\n` : "") +
      `TEXTE DE LA PAGE :\n${page.slice(0, PAGE_CHARS)}`,
  );
  return cleanFacts(parseJson(raw));
}

const pageLines = (text: string) => text.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter((l) => l.length > 2);

/**
 * Lignes retirées / ajoutées entre deux lectures d'une page (comparaison exacte, sans IA) :
 * une page identique, ou seulement réordonnée, ne coûte aucun appel à l'IA et ne crée aucune fausse alerte.
 */
export function lineDiff(before: string, after: string) {
  const a = pageLines(before);
  const b = pageLines(after);
  const setA = new Set(a);
  const setB = new Set(b);
  return { removed: [...new Set(a.filter((l) => !setB.has(l)))], added: [...new Set(b.filter((l) => !setA.has(l)))] };
}

/** Changements commerciaux réels, jugés par l'IA uniquement à partir des lignes qui ont changé. */
export async function detectChanges(name: string, url: string, prevFacts: Facts, diff: { removed: string[]; added: string[] }) {
  const clip = (lines: string[]) => lines.join("\n").slice(0, 6000) || "(aucune)";
  const raw = await ask(
    DIFF_SYSTEM,
    `Concurrent : ${name}\nPage : ${url}\n\nRELEVÉ PRÉCÉDENT :\n${JSON.stringify(prevFacts)}\n\nLIGNES RETIRÉES :\n${clip(diff.removed)}\n\nLIGNES AJOUTÉES :\n${clip(diff.added)}`,
  );
  return cleanChanges(parseJson(raw).changements);
}

/** Relit une page ; renvoie null si son contenu n'a pas bougé depuis le dernier relevé. */
async function checkPage(supabase: SupabaseClient, comp: Competitor, url: string, prev: Snapshot | null) {
  const page = (await readWebPage(url)).slice(0, 60_000);
  const hash = createHash("sha256").update(pageLines(page).join("\n")).digest("hex");
  // Sans changement commercial, on rafraîchit le dernier relevé : l'historique ne garde que les vrais changements.
  const touch = (extra: Record<string, unknown> = {}) =>
    supabase.from("competitor_snapshots").update({ checked_at: new Date().toISOString(), ...extra }).eq("id", prev!.id);
  if (prev?.content_hash === hash) {
    await touch();
    return null;
  }

  let facts: Facts;
  let changes: Change[] = [];
  const prevText = prev
    ? ((await supabase.from("competitor_snapshots").select("page_text").eq("id", prev.id).maybeSingle()).data?.page_text as string | null)
    : null;
  if (prev && prevText) {
    const diff = lineDiff(prevText, page);
    changes = diff.added.length || diff.removed.length ? await detectChanges(comp.name, url, prev.facts, diff) : [];
    if (!changes.length) {
      await touch({ content_hash: hash, page_text: page });
      return null;
    }
    facts = await extractFacts(comp.name, url, page, prev);
  } else {
    facts = await extractFacts(comp.name, url, page, null);
  }

  const { data, error } = await supabase
    .from("competitor_snapshots")
    .insert({ user_id: comp.user_id, competitor_id: comp.id, url, content_hash: hash, page_text: page, facts, changes })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "relevé non enregistré");
  return { id: data.id as string, facts, changes };
}

/** Dernier relevé de chaque page des concurrents donnés. */
async function latestSnapshots(supabase: SupabaseClient, competitorIds: string[]) {
  if (!competitorIds.length) return new Map<string, Snapshot>();
  const { data } = await supabase
    .from("competitor_snapshots")
    .select("id, competitor_id, url, content_hash, facts, changes, checked_at")
    .in("competitor_id", competitorIds)
    .is("error", null)
    .order("checked_at", { ascending: false })
    .limit(1000);
  const latest = new Map<string, Snapshot>();
  for (const s of (data ?? []) as Snapshot[]) {
    const key = `${s.competitor_id} ${s.url}`;
    if (!latest.has(key)) latest.set(key, s);
  }
  return latest;
}

export type VeilleResult = { pages: number; inchangees: number; changements: string[]; alertes: number; erreurs: string[] };

/**
 * Relit les pages des concurrents (les plus anciennement vérifiées d'abord, dans la limite de temps)
 * et alerte en cas de changement de prix ou d'offre. supabase : client de l'utilisateur ou client service.
 */
export async function runVeille(
  supabase: SupabaseClient,
  userId: string,
  timezone: string,
  opts: { competitorId?: string; maxPages?: number; budgetMs?: number } = {},
): Promise<VeilleResult> {
  const res: VeilleResult = { pages: 0, inchangees: 0, changements: [], alertes: 0, erreurs: [] };
  let q = supabase.from("competitors").select("id, user_id, project_id, name, urls, notes").eq("user_id", userId).eq("active", true);
  if (opts.competitorId) q = q.eq("id", opts.competitorId);
  const comps = ((await q).data ?? []) as Competitor[];
  const latest = await latestSnapshots(supabase, comps.map((c) => c.id));

  const queue = comps
    .flatMap((c) => c.urls.map((url) => ({ c, url, prev: latest.get(`${c.id} ${url}`) ?? null })))
    .sort((a, b) => (a.prev?.checked_at ?? "").localeCompare(b.prev?.checked_at ?? ""))
    .slice(0, opts.maxPages ?? 40);

  const deadline = Date.now() + (opts.budgetMs ?? 180_000);
  const today = todayIn(timezone);
  for (const { c, url, prev } of queue) {
    if (Date.now() > deadline) break;
    res.pages++;
    try {
      const r = await checkPage(supabase, c, url, prev);
      if (!r) {
        res.inchangees++;
        continue;
      }
      for (const ch of r.changes) res.changements.push(`${c.name} · ${ch.type} : ${ch.detail}`);
      const important = r.changes.filter((ch) => ch.type === "prix" || ch.type === "offre");
      if (important.length) {
        const detail = important.map((ch) => ch.detail).join(" · ");
        const isNew = await notify(supabase, userId, {
          kind: "alerte",
          title: `🕵️ ${c.name} : ${important.some((ch) => ch.type === "prix") ? "changement de prix" : "nouvelle offre"}`,
          body: `${detail} (${url})`,
          link: `/chat?q=${encodeURIComponent(`Mon concurrent ${c.name} a changé : ${detail} (${url}). Qu'est-ce que ça change pour moi et que dois-je faire ?`)}&send=1`,
          dedupeKey: `veille:${r.id}:${today}`,
        });
        if (isNew) res.alertes++;
      }
    } catch (err) {
      res.erreurs.push(`${c.name} (${url}) : ${err instanceof Error ? err.message : err}`);
    }
  }
  return res;
}

const SYNTHESIS_FORMAT = `
---
# SYNTHÈSE DE VEILLE CONCURRENTIELLE (hebdomadaire, automatique)
L'utilisateur n'est pas là pour répondre. À partir des relevés et actualités fournis (et UNIQUEMENT d'eux — n'invente rien), rédige en français :

## 🕵️ Veille concurrentielle — semaine du … au …
### 🔔 Ce qui a changé cette semaine (prix, offres, messages, nouveautés ; concurrent par concurrent ; « rien de nouveau » si c'est le cas)
### 💰 Prix actuels (tableau Concurrent | Produit / formule | Prix)
### 🎯 Messages et positionnement (ce que chacun met en avant)
### 📰 Actualités (seulement celles des résultats de recherche, avec le lien)
### 💡 Opportunités et menaces pour l'utilisateur (3 max chacune, avec [INTERPRÉTATION] ou [HYPOTHÈSE])
### 🔥 Actions recommandées (3 max, avec le pourquoi)
Indique clairement les pages qui n'ont pas pu être lues.`;

/** Synthèse hebdomadaire : enregistrée comme conversation et signalée par une notification « Rapport ». */
export async function weeklyVeille(supabase: SupabaseClient, userId: string, timezone: string) {
  const { data } = await supabase.from("competitors").select("id, user_id, project_id, name, urls, notes").eq("user_id", userId).eq("active", true);
  const comps = (data ?? []) as Competitor[];
  if (!comps.length) return null;

  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const [latest, { data: recent }, skills] = await Promise.all([
    latestSnapshots(supabase, comps.map((c) => c.id)),
    supabase.from("competitor_snapshots").select("competitor_id, url, changes, checked_at").in("competitor_id", comps.map((c) => c.id)).gte("checked_at", since).order("checked_at"),
    loadSkills(),
  ]);

  const blocks: string[] = [];
  for (const c of comps) {
    const changes = (recent ?? [])
      .filter((s) => s.competitor_id === c.id && Array.isArray(s.changes) && s.changes.length)
      .flatMap((s) => (s.changes as Change[]).map((ch) => `- ${String(s.checked_at).slice(0, 10)} · ${ch.type} : ${ch.detail} (${s.url})`));
    const facts = c.urls.map((url) => {
      const s = latest.get(`${c.id} ${url}`);
      return s ? `Page ${url} (relevé du ${s.checked_at.slice(0, 10)}) : ${JSON.stringify(s.facts)}` : `Page ${url} : jamais lue avec succès.`;
    });
    let news = "";
    if (hasWebSearchProvider()) {
      const r = await searchWeb(`"${c.name}" nouveauté OR promotion OR lancement OR annonce`, { topic: "news", days: 7 }).catch(() => null);
      news = r?.results.length ? r.results.map((x) => `- ${x.title} — ${x.url} : ${x.content.slice(0, 300)}`).join("\n") : "Aucune actualité trouvée.";
    }
    blocks.push(
      `## ${c.name}${c.notes ? ` (${c.notes})` : ""}\nChangements relevés sur 7 jours :\n${changes.join("\n") || "aucun"}\n\nDerniers relevés :\n${facts.join("\n")}` +
        (news ? `\n\nActualités Web (7 jours) :\n${news}` : ""),
    );
  }

  const skill = skills.find((s) => s.id === "veille-concurrentielle");
  const system = `Tu es Kimia, l'assistante marketing de l'utilisateur (application MARKOVA).${skill ? `\n\n# COMPÉTENCE : ${skill.name}\n${skill.prompt}` : ""}${SYNTHESIS_FORMAT}`;
  const text = (await ask(system, `Données de veille :\n\n${blocks.join("\n\n---\n\n")}`)).trim();
  if (!text) throw new Error("le modèle n'a renvoyé aucun texte");

  const projects = [...new Set(comps.map((c) => c.project_id))];
  const date = new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long", timeZone: timezone });
  const request = "Synthèse hebdomadaire de la veille concurrentielle.";
  const { data: conv, error } = await supabase
    .from("conversations")
    .insert({ user_id: userId, title: `🕵️ Veille concurrentielle du ${date}`, project_id: projects.length === 1 ? projects[0] : null })
    .select("id")
    .single();
  if (error || !conv) throw new Error(error?.message ?? "conversation non créée");
  await supabase.from("messages").insert([
    { conversation_id: conv.id, user_id: userId, role: "user", content: request },
    { conversation_id: conv.id, user_id: userId, role: "assistant", content: text, meta: { automatic: true } },
  ]);
  await notify(supabase, userId, {
    kind: "rapport",
    title: "Ta synthèse de veille concurrentielle est prête",
    body: text.replace(/```[\s\S]*?```/g, "").replace(/[#*|>`_-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200),
    link: `/c/${conv.id}`,
    dedupeKey: `veille-hebdo:${todayIn(timezone)}`,
  });
  return { conversationId: conv.id as string };
}

// ─── Outils de l'agent ───────────────────────────────────────────
// Réglages internes (liste de concurrents) : pas de validation nécessaire.

export const VEILLE_TOOLS: ToolSet["defs"] = [
  {
    name: "veille_ajouter",
    label: "🕵️ Ajout d'un concurrent",
    description:
      "Ajoute un concurrent à la veille automatique (ou ajoute des pages à un concurrent existant). Ses pages sont relues chaque jour : alerte si un prix ou une offre change, synthèse chaque lundi. " +
      "Donne la page d'accueil ET, si elles existent, les pages tarifs / offres / boutique (trouve-les avec web_rechercher ou web_lire_page si l'utilisateur ne donne que le nom). Le premier relevé est fait tout de suite.",
    parameters: {
      type: "object",
      properties: {
        nom: { type: "string" },
        urls: { type: "array", items: { type: "string" }, description: "Pages à surveiller (5 max)" },
        notes: { type: "string", description: "Ce qu'il faut savoir (secteur, pourquoi c'est un concurrent)" },
      },
      required: ["nom", "urls"],
    },
  },
  {
    name: "veille_lister",
    label: "🕵️ Concurrents suivis",
    description: "Liste les concurrents suivis, leurs pages et la date du dernier relevé.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "veille_historique",
    label: "🕵️ Historique de veille",
    description: "Historique des relevés d'un concurrent (ou de tous) : prix, offres, messages, nouveautés actuels et changements détectés sur N jours.",
    parameters: { type: "object", properties: { nom: { type: "string", description: "Vide = tous" }, jours: { type: "number", description: "Défaut 30" } } },
  },
  {
    name: "veille_verifier",
    label: "🕵️ Vérification des concurrents",
    description: "Relit maintenant les pages d'un concurrent (ou des concurrents les moins récemment vérifiés) et renvoie les changements.",
    parameters: { type: "object", properties: { nom: { type: "string" } } },
  },
  {
    name: "veille_supprimer",
    label: "🕵️ Retrait d'un concurrent",
    description: "Arrête de suivre un concurrent (son historique est supprimé).",
    parameters: { type: "object", properties: { nom: { type: "string" } }, required: ["nom"] },
  },
];

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

function normalizeUrl(raw: string) {
  const s = raw.trim();
  if (!s) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    return u.hostname.includes(".") ? u.href : null;
  } catch {
    return null;
  }
}

function describeFacts(f: Facts) {
  return [
    f.prix.length ? `prix : ${f.prix.map((p) => `${p.produit || "?"} ${p.prix}`).join(" · ")}` : "",
    f.offres.length ? `offres : ${f.offres.join(" · ")}` : "",
    f.messages.length ? `messages : ${f.messages.join(" · ")}` : "",
    f.nouveautes.length ? `nouveautés : ${f.nouveautes.join(" · ")}` : "",
  ]
    .filter(Boolean)
    .map((l) => `  ${l}`)
    .join("\n");
}

/** Renvoie null si l'outil n'est pas un outil de veille. */
export async function runVeilleTool(
  supabase: SupabaseClient,
  name: string,
  args: Record<string, unknown>,
  ctx: { userId: string; projectId: string | null; timezone: string },
): Promise<string | null> {
  if (!name.startsWith("veille_")) return null;
  const { data } = await supabase.from("competitors").select("id, user_id, project_id, name, urls, notes").eq("user_id", ctx.userId).eq("active", true).order("name");
  const all = (data ?? []) as Competitor[];
  const find = (n: unknown) => {
    const w = norm(String(n ?? ""));
    return w ? (all.find((c) => norm(c.name) === w) ?? all.find((c) => norm(c.name).includes(w) || w.includes(norm(c.name))) ?? null) : null;
  };

  if (name === "veille_lister") {
    if (!all.length) return "Aucun concurrent suivi. Ajoute-en avec veille_ajouter.";
    const latest = await latestSnapshots(supabase, all.map((c) => c.id));
    return all
      .map((c) => {
        const pages = c.urls.map((u) => `  - ${u} · ${latest.get(`${c.id} ${u}`)?.checked_at.slice(0, 10) ?? "jamais lue"}`).join("\n");
        return `- **${c.name}**${c.notes ? ` (${c.notes})` : ""}\n${pages}`;
      })
      .join("\n");
  }

  if (name === "veille_ajouter") {
    const nom = String(args.nom ?? "").trim();
    if (!nom) return "Nom du concurrent manquant.";
    const raw = Array.isArray(args.urls) ? args.urls : [args.urls ?? args.url];
    const urls = raw.map((u) => normalizeUrl(String(u ?? ""))).filter((u): u is string => Boolean(u));
    if (!urls.length) return "Aucune adresse valide : trouve le site du concurrent (web_rechercher) puis réessaie.";
    const existing = find(nom);
    let comp: Competitor;
    if (existing) {
      const merged = [...new Set([...existing.urls, ...urls])].slice(0, 8);
      const { error } = await supabase.from("competitors").update({ urls: merged, ...(args.notes ? { notes: String(args.notes) } : {}) }).eq("id", existing.id);
      if (error) return `Erreur : ${error.message}`;
      comp = { ...existing, urls: merged };
    } else {
      const { data: created, error } = await supabase
        .from("competitors")
        .insert({ user_id: ctx.userId, project_id: ctx.projectId, name: nom, urls: urls.slice(0, 5), notes: args.notes ? String(args.notes) : null })
        .select("id, user_id, project_id, name, urls, notes")
        .single();
      if (error || !created) return `Erreur : ${error?.message}`;
      comp = created as Competitor;
    }
    // Premier relevé immédiat (temps limité : la réponse du chat ne doit pas attendre trop).
    const r = await runVeille(supabase, ctx.userId, ctx.timezone, { competitorId: comp.id, maxPages: 3, budgetMs: 30_000 });
    const latest = await latestSnapshots(supabase, [comp.id]);
    const facts = comp.urls
      .map((u) => {
        const s = latest.get(`${comp.id} ${u}`);
        return s ? `- ${u}\n${describeFacts(s.facts) || "  (aucun prix ni offre visible sur cette page)"}` : `- ${u} : pas encore lue`;
      })
      .join("\n");
    return (
      `${existing ? "Pages ajoutées à" : "Concurrent ajouté :"} « ${comp.name} » (${comp.urls.length} page(s)). Vérification automatique chaque jour, alerte si un prix ou une offre change, synthèse chaque lundi.\n` +
      `Premier relevé :\n${facts}` +
      (r.erreurs.length ? `\nPages illisibles : ${r.erreurs.join(" ; ")}` : "")
    );
  }

  if (name === "veille_supprimer") {
    const c = find(args.nom);
    if (!c) return `Concurrent introuvable. Suivis : ${all.map((x) => x.name).join(", ") || "aucun"}.`;
    const { error } = await supabase.from("competitors").delete().eq("id", c.id);
    return error ? `Erreur : ${error.message}` : `« ${c.name} » n'est plus suivi.`;
  }

  if (name === "veille_verifier") {
    const c = args.nom ? find(args.nom) : null;
    if (args.nom && !c) return `Concurrent introuvable. Suivis : ${all.map((x) => x.name).join(", ") || "aucun"}.`;
    if (!all.length) return "Aucun concurrent suivi.";
    const r = await runVeille(supabase, ctx.userId, ctx.timezone, { competitorId: c?.id, maxPages: 4, budgetMs: 35_000 });
    return (
      `${r.pages} page(s) relue(s), ${r.inchangees} sans changement.\n` +
      (r.changements.length ? `Changements :\n${r.changements.map((x) => `- ${x}`).join("\n")}` : "Aucun changement détecté.") +
      (r.erreurs.length ? `\nErreurs : ${r.erreurs.join(" ; ")}` : "") +
      `\nUtilise veille_historique pour les prix et offres actuels.`
    );
  }

  if (name === "veille_historique") {
    const c = args.nom ? find(args.nom) : null;
    if (args.nom && !c) return `Concurrent introuvable. Suivis : ${all.map((x) => x.name).join(", ") || "aucun"}.`;
    const comps = c ? [c] : all;
    if (!comps.length) return "Aucun concurrent suivi.";
    const days = Math.min(Math.max(Number(args.jours ?? 30), 1), 365);
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    const [latest, { data: recent }] = await Promise.all([
      latestSnapshots(supabase, comps.map((x) => x.id)),
      supabase.from("competitor_snapshots").select("competitor_id, url, changes, checked_at").in("competitor_id", comps.map((x) => x.id)).gte("checked_at", since).order("checked_at"),
    ]);
    return comps
      .map((x) => {
        const current = x.urls
          .map((u) => {
            const s = latest.get(`${x.id} ${u}`);
            return s ? `- ${u} (relevé du ${s.checked_at.slice(0, 10)})\n${describeFacts(s.facts) || "  (rien de relevé)"}` : `- ${u} : jamais lue`;
          })
          .join("\n");
        const changes = (recent ?? [])
          .filter((s) => s.competitor_id === x.id && Array.isArray(s.changes) && s.changes.length)
          .flatMap((s) => (s.changes as Change[]).map((ch) => `- ${String(s.checked_at).slice(0, 10)} · ${ch.type} : ${ch.detail}`));
        return `### ${x.name}\nÉtat actuel :\n${current}\nChangements sur ${days} jours :\n${changes.join("\n") || "aucun"}`;
      })
      .join("\n\n");
  }
  return null;
}
