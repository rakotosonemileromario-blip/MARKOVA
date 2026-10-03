import type { SupabaseClient } from "@supabase/supabase-js";
import { generate, type ToolSet } from "./llm";
import { readWebPage } from "./webtools";
import { hasWebSearchProvider, searchWeb } from "./websearch";
import { notify } from "./notify";
import type { Project } from "./projects";

// Marchés et études de marché. Un projet peut viser plusieurs marchés (n'importe quel pays, région, langue),
// chacun relié aux pages Facebook / Instagram qui s'adressent à lui. Une étude = un projet × un marché :
// offres → cibles → besoins → PESTEL → mots-clés (suggestions Google du pays, dans sa langue) → sujets → synthèse.
// Chaque étape est enregistrée dès qu'elle est finie : une étude interrompue reprend où elle s'était arrêtée.

import { countryName, STEP_LABELS, STEPS, type Market, type Step } from "./market-shared";

export { countryName, STEP_LABELS, STEPS, type Market, type Step };

export type Study = {
  id: string; user_id: string; project_id: string | null; market: string; country: string; region: string | null; language: string;
  inputs: { offres?: string; site?: string; secteur?: string; pages?: string[] };
  sections: Partial<Record<Step, string>>; sources: { title: string; url: string }[]; status: string; started_at: string | null; created_at: string;
};

export function cleanMarket(raw: Record<string, unknown>): Market | string {
  const country = String(raw.pays ?? raw.country ?? "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) return `pays invalide (« ${raw.pays ?? ""} ») : code ISO à 2 lettres (MG, CA, FR, BE, SN, US…).`;
  const language = String(raw.langue ?? raw.language ?? "fr").trim().toLowerCase();
  if (!/^[a-z]{2,3}$/.test(language)) return `langue invalide (« ${raw.langue ?? ""} ») : code ISO (fr, en, es, mg…).`;
  const region = String(raw.region ?? "").trim() || null;
  const label = String(raw.libelle ?? raw.label ?? "").trim() || (region ? `${region} (${countryName(country)})` : countryName(country));
  const pages = Array.isArray(raw.pages) ? raw.pages.map((p) => String(p).trim()).filter(Boolean) : [];
  return { label, country, region, language, pages };
}

const sameMarket = (a: { country: string; region?: string | null }, b: { country: string; region?: string | null }) =>
  a.country === b.country && (a.region ?? "").toLowerCase() === (b.region ?? "").toLowerCase();

/** Marchés du projet (lus à part : la colonne n'existe qu'après la mise à jour du schéma). */
export async function getMarkets(supabase: SupabaseClient, projectId: string | null): Promise<Market[]> {
  if (!projectId) return [];
  const { data, error } = await supabase.from("projects").select("markets").eq("id", projectId).maybeSingle();
  return error ? [] : ((data?.markets as Market[]) ?? []);
}

/** Dernière étude terminée de chaque marché du projet (pour les consignes de l'agent). */
export async function latestStudies(supabase: SupabaseClient, projectId: string | null) {
  if (!projectId) return [];
  const { data, error } = await supabase
    .from("market_studies")
    .select("id, market, country, region, language, sections, status, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) return [];
  const out: { market: string; country: string; region: string | null; language: string; status: string; synthese: string | null; date: string }[] = [];
  for (const s of data ?? []) {
    if (out.some((o) => sameMarket(o, s))) continue;
    out.push({
      market: s.market, country: s.country, region: s.region, language: s.language, status: s.status,
      synthese: (s.sections as Study["sections"])?.synthese ?? null, date: String(s.created_at).slice(0, 10),
    });
  }
  return out;
}

// ─── Moteur ──────────────────────────────────────────────────────

async function ask(system: string, text: string) {
  let out = "";
  for await (const ev of generate({ system, turns: [{ role: "user", text }], webSearch: false })) {
    if (ev.type === "text") out += ev.text;
  }
  if (!out.trim()) throw new Error("le modèle n'a renvoyé aucun texte");
  return out.trim();
}

function parseJson(raw: string): Record<string, unknown> {
  const body = raw.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1] ?? raw;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("réponse de l'IA illisible (pas de JSON)");
  return JSON.parse(body.slice(start, end + 1));
}

/** Suggestions Google (ce que les gens tapent vraiment), pour un pays et une langue. Gratuit. */
export async function googleSuggest(q: string, country: string, language: string): Promise<string[]> {
  const url = `https://suggestqueries.google.com/complete/search?client=firefox&hl=${encodeURIComponent(language)}&gl=${encodeURIComponent(country.toLowerCase())}&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(8_000) });
  if (!res.ok) return [];
  const json = (await res.json().catch(() => null)) as [string, string[]] | null;
  return Array.isArray(json?.[1]) ? json![1] : [];
}

type Search = { query: string; results: { title: string; url: string; content: string }[] };

async function searches(queries: string[], opts: { topic?: "news"; days?: number } = {}): Promise<Search[]> {
  if (!hasWebSearchProvider()) return [];
  return Promise.all(
    queries.slice(0, 6).map(async (query) => ({ query, results: (await searchWeb(query, opts).catch(() => null))?.results ?? [] })),
  );
}

/** Résultats numérotés [1], [2]… : l'IA ne cite que ces numéros, transformés ensuite en liens (voir linkify). */
function searchBlock(list: Search[], refs: { title: string; url: string }[]) {
  if (!list.length) return "(recherche Web indisponible : n'avance aucun fait ni chiffre ; signale les points à vérifier)";
  return list
    .map(
      (s) =>
        `### Recherche : ${s.query}\n` +
        (s.results
          .map((r) => {
            refs.push({ title: r.title, url: r.url });
            return `[${refs.length}] ${r.title} : ${r.content.slice(0, 700)}`;
          })
          .join("\n") || "(aucun résultat)"),
    )
    .join("\n\n");
}

/**
 * Garde-fou contre les sources inventées : [n] devient un lien vers la recherche n ; tout lien ou adresse
 * que l'IA aurait écrit elle-même et qui ne fait pas partie des sources réellement consultées est retiré.
 */
export function linkify(text: string, refs: { title: string; url: string }[], allowed: Set<string>) {
  const ok = new Set([...allowed, ...refs.map((r) => r.url)]);
  return text
    // Variantes écrites par l'IA (« [[3]] » sans lien, « [(3)] ») ramenées à « [3] ».
    .replace(/\[\[(\d{1,3})\]\](?!\()/g, "[$1]")
    .replace(/\[\((\d{1,3})\)\]/g, "[$1]")
    .replace(/(?<!\[)\[(\d{1,3})\](?![(\]])/g, (m, n) => {
      const r = refs[Number(n) - 1];
      return r ? `[[${n}]](${r.url})` : "";
    })
    .replace(/\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g, (m, label, url) => (ok.has(url) ? m : label))
    .replace(/<(https?:\/\/[^>\s]+)>/g, (m, url) => (ok.has(url) ? m : ""))
    .replace(/(^|[\s(|])(https?:\/\/[^\s)|]+)/g, (m, pre, url) => (ok.has(url) ? m : `${pre}`));
}

const plainKw = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[*_`«»"“”]/g, "").replace(/\s+/g, " ").trim();

/**
 * Mots-clés : la première colonne des tableaux doit être une vraie suggestion Google.
 * Une ligne dont le mot-clé n'a pas été vu dans les suggestions est marquée (l'IA a pu l'inventer).
 */
export function flagUnseenKeywords(text: string, seen: Set<string>) {
  if (!seen.size) return text;
  const known = new Set([...seen].map(plainKw));
  let inIdeas = false;
  return text
    .split("\n")
    .map((line) => {
      if (/^#{1,4}\s/.test(line)) inIdeas = /id[ée]es?\s+à\s+v[ée]rifier|contenus?\s+à\s+cr[ée]er/i.test(line);
      const m = line.match(/^\|\s*([^|]+?)\s*\|/);
      if (inIdeas || !m || /^[-:\s]+$/.test(m[1]) || /mot.?cl/i.test(m[1])) return line;
      return known.has(plainKw(m[1])) ? line : line.replace(m[0], `| ${m[1]} ⚠️ non vu dans Google |`);
    })
    .join("\n");
}

const COMMON = `Tu es MARKOVA, agent de marketing digital, et tu réalises une ÉTUDE DE MARCHÉ pour un marché précis.
Règles :
- Écris en français (c'est la langue de l'utilisateur), mais garde dans la langue du marché tout ce qui sera utilisé tel quel sur ce marché (mots-clés, accroches, expressions des clients).
- Adapte-toi au marché : pays, région, langue, devise, culture, vocabulaire local (ex. québécismes au Québec, ariary à Madagascar).
- SOURCES : cite une recherche UNIQUEMENT par son numéro entre crochets, ex. [3]. N'écris JAMAIS d'adresse Web ni de lien toi-même : ils seraient supprimés.
- CHIFFRES : tout chiffre (montant, pourcentage, taille de marché, croissance, nombre) doit venir d'une recherche citée [n]. Sans source, n'écris aucun chiffre : décris la tendance en mots et marque-la [HYPOTHÈSE].
- Une déduction = [INTERPRÉTATION] ou [HYPOTHÈSE]. N'invente aucune loi, aucun programme, aucune organisation, aucune citation.
- Markdown clair : titres ###, tableaux, listes courtes, emojis en tête de section. Pas d'introduction ni de conclusion inutiles.`;

export function context(s: Study, project: { name: string; description: string | null; brand_voice?: string | null } | null, extra: string) {
  return [
    `MARCHÉ : ${s.market} · pays ${s.country} (${countryName(s.country)})${s.region ? ` · région ${s.region}` : ""} · langue ${s.language}`,
    project ? `PROJET : ${project.name}${project.description ? ` — ${project.description}` : ""}` : "",
    s.inputs.secteur ? `SECTEUR : ${s.inputs.secteur}` : "",
    s.inputs.pages?.length ? `PAGES QUI VISENT CE MARCHÉ : ${s.inputs.pages.join(", ")}` : "",
    s.inputs.offres ? `OFFRES DÉCRITES PAR L'UTILISATEUR :\n${s.inputs.offres}` : "",
    project?.brand_voice ? `VOIX DE MARQUE :\n${project.brand_voice.slice(0, 2500)}` : "",
    extra,
  ]
    .filter(Boolean)
    .join("\n\n");
}

const STEP_PROMPTS: Record<Exclude<Step, "plan">, string> = {
  offres:
    "Étape OFFRES. À partir UNIQUEMENT de ce qui est fourni (fichiers et mémoire du projet, site, offres décrites, description), rédige : ### 🧾 Offres (tableau Offre | Pour qui | Prix si connu | Bénéfice principal), ### 💎 Positionnement et avantages, ### ❓ Informations manquantes (ce qu'il faudrait préciser). " +
    "Reprends les noms, formules et prix EXACTS des documents. N'invente AUCUNE offre, aucun pack, aucun prix, aucun argument (écologique, local…) qui n'y figure pas. " +
    "Si les informations fournies ne disent pas concrètement ce que vend le projet, réponds UNIQUEMENT : INFO_INSUFFISANTE: <ce qu'il faut que l'utilisateur précise>.",
  cibles:
    "Étape CIBLES. Identifie les 3 à 5 clients types les plus pertinents POUR CES OFFRES SUR CE MARCHÉ. Pour chacun : ### 👤 nom parlant (ex. « La PME qui veut vendre en ligne »), puis profil (B2B : secteur, taille, décideur ; B2C : âge, situation, revenus, lieu), problème principal, motivations, freins et objections, déclencheurs d'achat, où le toucher (canaux, réseaux, moments), message clé (dans la langue du marché), priorité (🔥 haute / 🟡 moyenne / ⚪ faible) et pourquoi. Termine par un tableau récapitulatif Cible | Taille estimée du potentiel (qualitative) | Facilité à convaincre | Priorité.",
  besoins:
    "Étape BESOINS ET ATTENTES. Cartographie les besoins de chaque cible pour ces offres : ### 🗺️ Cartographie (tableau Cible | Besoins fonctionnels | Besoins émotionnels | Attentes (prix, délai, qualité, service) | Irritants actuels | Critères de choix). Puis ### 💬 Ce que disent les clients (expressions réelles relevées dans les recherches, avec source, dans leur langue). Puis ### 🎯 Ce que l'offre doit prouver (3 à 5 points).",
  pestel:
    "Étape PESTEL. Analyse les facteurs Politiques, Économiques, Sociaux, Technologiques, Environnementaux et Légaux de CE marché qui touchent CES offres. Pour chaque lettre : ### avec emoji, 2 à 4 facteurs avec source quand elle existe, puis l'impact (🟢 opportunité / 🔴 menace / 🟡 à surveiller). Termine par ### ⚖️ Opportunités et menaces prioritaires (tableau Facteur | Opportunité ou menace | Ce qu'il faut faire).",
  mots_cles:
    "Étape MOTS-CLÉS. Voici des requêtes RÉELLES tapées sur Google dans ce pays (suggestions Google). Garde les pertinentes pour les offres (dans leur langue d'origine, sans les modifier) et classe-les : ### 🔎 Par intention (tableau Mot-clé | Intention : information / comparaison / achat / local | Cible concernée | Priorité). Puis ### 💡 Contenus à créer (pour les 8 meilleurs mots-clés : titre de contenu, format, page ou canal). Précise que les volumes de recherche ne sont pas disponibles gratuitement. N'invente aucun mot-clé absent de la liste, sauf dans une section ### ➕ Idées à vérifier clairement séparée.",
  sujets:
    "Étape SUJETS ET PLAN DE COMMUNICATION. En t'appuyant sur les cibles, besoins, PESTEL et mots-clés : ### 🧱 Piliers de contenu (3 à 5, avec la part de publication). ### 📝 15 sujets (tableau Sujet / accroche dans la langue du marché | Cible | Besoin ou mot-clé | Format | Canal). ### 📅 Plan sur 4 semaines (tableau Semaine | Objectif | Publications | Canal). Respecte la voix de marque si elle est fournie.",
  synthese:
    "Étape SYNTHÈSE. En 150 à 250 mots maximum, sans titre : marché, 3 cibles prioritaires (avec leur message clé), 3 besoins majeurs, 2 opportunités et 1 menace PESTEL, 5 mots-clés prioritaires, 3 piliers de contenu. Ce texte sera relu par MARKOVA avant chaque contenu pour ce marché : il doit être dense et concret.",
};

const PLAN_SYSTEM = `${COMMON}
Étape PRÉPARATION. Réponds UNIQUEMENT par un JSON :
{"secteur": "…", "cibles": ["requête", "requête"], "besoins": ["requête", "requête", "requête"], "pestel": ["requête P", "requête E", "requête S", "requête T", "requête E", "requête L"], "graines": ["…", "… 12 maximum"]}
- secteur : le secteur d'activité en quelques mots.
- cibles / besoins / pestel : requêtes de recherche Web À FAIRE DANS LA LANGUE DU MARCHÉ et centrées sur CE pays / cette région (clients, avis, forums, attentes, actualités, réglementation…).
- graines : 8 à 12 débuts de recherche Google courts (1 à 3 mots, dans la langue du marché) que les clients taperaient pour trouver ces offres (sans le nom de la marque).`;

/**
 * Ce que MARKOVA sait réellement du projet : description, mémoire, fichiers (textes, PDF, Word, tableurs).
 * Sert à l'étape « offres » et à vérifier, avant de lancer une étude, qu'il y a de quoi travailler.
 */
export async function projectKnowledge(supabase: SupabaseClient, projectId: string | null) {
  if (!projectId) return "";
  const [{ data: project }, { data: mems }, { data: files }] = await Promise.all([
    supabase.from("projects").select("name, description").eq("id", projectId).maybeSingle(),
    supabase.from("memories").select("category, content").eq("project_id", projectId).eq("active", true).limit(40),
    supabase.from("files").select("name, extracted_text").eq("project_id", projectId).eq("status", "pret").not("extracted_text", "is", null).order("created_at", { ascending: false }).limit(10),
  ]);
  let budget = 18_000;
  const docs = (files ?? [])
    .map((f) => {
      const text = String(f.extracted_text ?? "").trim().slice(0, Math.max(0, budget));
      budget -= text.length;
      return text ? `### 📎 ${f.name}\n${text}` : "";
    })
    .filter(Boolean);
  return [
    project?.description ? `DESCRIPTION DU PROJET : ${project.description}` : "",
    mems?.length ? `MÉMOIRE DU PROJET :\n${mems.map((m) => `- (${m.category}) ${m.content}`).join("\n")}` : "",
    docs.length ? `FICHIERS DU PROJET :\n${docs.join("\n\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function runStep(s: Study, step: Step, base: string, knowledge = "") {
  // Numérotation unique pour toute l'étude : les sources des étapes précédentes gardent leur numéro,
  // celles de cette étape continuent la suite (une synthèse peut donc citer [13] d'une étape antérieure).
  const refs: { title: string; url: string }[] = [...s.sources];
  const plan = s.sections.plan ? (JSON.parse(s.sections.plan) as { secteur?: string; cibles?: string[]; besoins?: string[]; pestel?: string[]; graines?: string[] }) : {};
  const done = (k: Step) => (s.sections[k] ? `\n\n## Étape ${STEP_LABELS[k]} (déjà faite)\n${s.sections[k]}` : "");

  if (step === "plan") {
    return { text: JSON.stringify(parseJson(await ask(PLAN_SYSTEM, base + done("offres")))), sources: [] };
  }
  let extra = "";
  let suggestions = new Set<string>();
  if (step === "cibles") {
    extra = done("offres") + `\n\n## Recherches\n${searchBlock(await searches(plan.cibles ?? []), refs)}`;
  } else if (step === "besoins") {
    extra = done("offres") + done("cibles") + `\n\n## Recherches\n${searchBlock(await searches(plan.besoins ?? []), refs)}`;
  } else if (step === "pestel") {
    extra = done("offres") + `\n\n## Actualités (12 derniers mois)\n${searchBlock(await searches(plan.pestel ?? [], { topic: "news", days: 365 }), refs)}`;
  } else if (step === "mots_cles") {
    const seeds = (plan.graines ?? []).slice(0, 12);
    const lists = await Promise.all(seeds.map((g) => googleSuggest(g, s.country, s.language).catch(() => [] as string[])));
    const all = [...new Set(lists.flat().map((x) => x.trim().toLowerCase()))];
    suggestions = new Set(all);
    extra = done("offres") + done("cibles") + `\n\n## Suggestions Google (pays ${s.country}, langue ${s.language}) — ${all.length} requêtes\n${all.join("\n") || "(aucune)"}`;
  } else if (step === "sujets") {
    extra = done("cibles") + done("besoins") + done("pestel") + done("mots_cles");
  } else if (step === "synthese") {
    extra = done("offres") + done("cibles") + done("besoins") + done("pestel") + done("mots_cles") + done("sujets");
  } else if (step === "offres") {
    extra =
      (knowledge ? `\n\n${knowledge}` : "") +
      (s.inputs.site
        ? `\n\n## Site\n${(await readWebPage(s.inputs.site).catch((e) => `(site illisible : ${e instanceof Error ? e.message : e})`)).slice(0, 12_000)}`
        : "");
  }
  let raw = await ask(`${COMMON}\n\n${STEP_PROMPTS[step as Exclude<Step, "plan">]}`, base + extra);
  if (step === "mots_cles") raw = flagUnseenKeywords(raw, suggestions);
  // Liens autorisés : sources de cette étape, des étapes précédentes (recopiées) et le site fourni.
  const allowed = new Set([...s.sources.map((x) => x.url), ...(s.inputs.site ? [s.inputs.site] : [])]);
  return { text: linkify(raw, refs, allowed), sources: refs.slice(s.sources.length) };
}

/**
 * Fait avancer une étude jusqu'à la fin ou jusqu'à l'échéance (elle reprendra plus tard).
 * supabase : client de l'utilisateur ou client service. Renvoie le statut atteint.
 */
export async function runStudy(supabase: SupabaseClient, studyId: string, deadline: number): Promise<string> {
  // Verrou : une seule exécution à la fois (une exécution bloquée depuis plus de 6 min peut être reprise).
  const stale = new Date(Date.now() - 6 * 60_000).toISOString();
  const { data: locked } = await supabase
    .from("market_studies")
    .update({ status: "en_cours", started_at: new Date().toISOString(), error: null })
    .eq("id", studyId)
    .or(`status.eq.en_attente,and(status.eq.en_cours,started_at.lt."${stale}"),status.eq.erreur`)
    .select("*")
    .maybeSingle();
  if (!locked) return "déjà en cours ou terminée";
  const s = locked as Study;

  const { data: project } = s.project_id
    ? await supabase.from("projects").select("name, description, brand_voice").eq("id", s.project_id).maybeSingle()
    : { data: null };
  const knowledge = await projectKnowledge(supabase, s.project_id);

  try {
    for (const step of STEPS) {
      if (s.sections[step]) continue;
      if (Date.now() > deadline - 45_000) {
        // Pas assez de temps pour une étape : elle reprendra (page ouverte ou tâche planifiée).
        await supabase.from("market_studies").update({ status: "en_attente", updated_at: new Date().toISOString() }).eq("id", s.id);
        return "en_attente";
      }
      const plan = s.sections.plan ? (JSON.parse(s.sections.plan) as { secteur?: string }) : {};
      const base = context(s, project, "") + (plan.secteur && !s.inputs.secteur ? `\n\nSECTEUR (déduit) : ${plan.secteur}` : "");
      const { text, sources } = await runStep(s, step, base, knowledge);
      if (step === "offres" && /^\s*INFO_INSUFFISANTE/i.test(text)) {
        // On s'arrête plutôt que d'inventer le produit : l'utilisateur doit décrire ses offres.
        const missing = text.replace(/^\s*INFO_INSUFFISANTE\s*:?\s*/i, "").trim();
        throw new Error(
          `MARKOVA ne sait pas encore ce que vend ce projet${missing ? ` (${missing.slice(0, 300)})` : ""}. Décris tes offres (produits, formules, prix, pour qui), donne le site, ou ajoute la fiche produit dans les fichiers du projet, puis relance l'étude.`,
        );
      }
      s.sections[step] = text;
      s.sources = [...s.sources, ...sources]; // ni dédoublonnage ni coupe : le numéro [n] d'une source = sa position
      await supabase
        .from("market_studies")
        .update({ sections: s.sections, sources: s.sources, started_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", s.id);
    }
    await supabase.from("market_studies").update({ status: "terminee", updated_at: new Date().toISOString() }).eq("id", s.id);
    await notify(supabase, s.user_id, {
      kind: "rapport",
      title: `Étude de marché prête : ${project?.name ?? "projet"} · ${s.market}`,
      body: (s.sections.synthese ?? "").replace(/[#*|>`_]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200),
      link: `/marche?etude=${s.id}`,
      dedupeKey: `etude:${s.id}`,
    }).catch(() => false);
    return "terminee";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await supabase.from("market_studies").update({ status: "erreur", error: msg.slice(0, 500), updated_at: new Date().toISOString() }).eq("id", s.id);
    return "erreur";
  }
}

/** Études arrêtées en route (délai dépassé) : reprises par la tâche planifiée. */
export async function resumeStalledStudies(admin: SupabaseClient, deadline: number) {
  const stale = new Date(Date.now() - 6 * 60_000).toISOString();
  const { data } = await admin
    .from("market_studies")
    .select("id")
    .or(`status.eq.en_attente,and(status.eq.en_cours,started_at.lt."${stale}")`)
    .lt("updated_at", new Date(Date.now() - 60_000).toISOString())
    .order("created_at")
    .limit(2);
  const done = [];
  for (const s of data ?? []) {
    if (Date.now() > deadline - 60_000) break;
    done.push(await runStudy(admin, s.id, deadline));
  }
  return done;
}

// ─── Outils de l'agent ───────────────────────────────────────────

const MARKET_PARAMS = {
  pays: { type: "string", description: "Code pays ISO à 2 lettres : MG, CA, FR, BE, CH, SN, CI, US…" },
  region: { type: "string", description: "Région ou ville si plus précise que le pays (ex. Québec)" },
  langue: { type: "string", description: "Langue du marché, code ISO : fr, en, es, mg…" },
  libelle: { type: "string", description: "Nom lisible (défaut : déduit du pays et de la région)" },
};

export const MARKET_TOOLS: ToolSet["defs"] = [
  {
    name: "marches_lister",
    label: "🌍 Marchés du projet",
    description: "Liste les marchés visés par le projet (pays, région, langue, pages qui s'adressent à chacun) et l'état de leurs études de marché.",
    parameters: { type: "object", properties: { projet: { type: "string" } } },
  },
  {
    name: "marches_definir",
    label: "🌍 Marchés du projet",
    description:
      "Enregistre (remplace) la liste COMPLÈTE des marchés visés par le projet : n'importe quel pays, région et langue, avec les pages Facebook / Instagram qui visent chacun. " +
      "Déduis-les toi-même (meta_pages : noms des pages, pays ; langue des publications ; site) et ne demande à l'utilisateur que si c'est ambigu. Appelle marches_lister avant pour ne rien perdre. Réglage interne : pas de validation.",
    parameters: {
      type: "object",
      properties: {
        projet: { type: "string", description: "Défaut : projet actif" },
        marches: {
          type: "array",
          items: { type: "object", properties: { ...MARKET_PARAMS, pages: { type: "array", items: { type: "string" } } }, required: ["pays", "langue"] },
        },
      },
      required: ["marches"],
    },
  },
  {
    name: "etude_marche_lancer",
    label: "🧭 Étude de marché",
    description:
      "Lance l'étude de marché d'un projet pour UN marché (cibles, besoins et attentes, PESTEL, mots-clés Google du pays, sujets et plan de communication). Elle tourne en arrière-plan (2 à 5 min) et l'utilisateur est notifié à la fin. " +
      "Une étude par marché : pour plusieurs marchés, appelle l'outil une fois par marché. Elle consomme ~15 recherches Web : ne la relance pas si une étude récente existe (sauf « forcer »).",
    parameters: {
      type: "object",
      properties: {
        projet: { type: "string", description: "Défaut : projet actif" },
        ...MARKET_PARAMS,
        offres: { type: "string", description: "Offres, prix, avantages connus (de la conversation, de la mémoire ou des fichiers)" },
        site: { type: "string", description: "Site Web ou page d'offre à lire" },
        secteur: { type: "string" },
        pages: { type: "array", items: { type: "string" }, description: "Pages Facebook / Instagram qui visent ce marché" },
        forcer: { type: "boolean", description: "Relancer même si une étude de moins de 30 jours existe" },
      },
      required: ["pays", "langue"],
    },
  },
  {
    name: "etude_marche_lire",
    label: "🧭 Lecture de l'étude de marché",
    description: "Lit l'étude de marché d'un projet pour un marché : une section (offres, cibles, besoins, pestel, mots_cles, sujets, synthese) ou tout.",
    parameters: {
      type: "object",
      properties: { projet: { type: "string" }, pays: { type: "string" }, region: { type: "string" }, section: { type: "string", enum: [...STEPS.filter((x) => x !== "plan"), "tout"] } },
    },
  },
];

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

/** Renvoie null si l'outil n'est pas un outil de marché. `start` lance l'étude en arrière-plan. */
export async function runMarketTool(
  supabase: SupabaseClient,
  name: string,
  args: Record<string, unknown>,
  ctx: { userId: string; current: Project | null; all: Project[]; start: (studyId: string) => void },
): Promise<string | null> {
  if (!["marches_lister", "marches_definir", "etude_marche_lancer", "etude_marche_lire"].includes(name)) return null;
  const wanted = norm(String(args.projet ?? ""));
  const project = wanted
    ? (ctx.all.find((p) => norm(p.name) === wanted) ?? ctx.all.find((p) => norm(p.name).includes(wanted) || wanted.includes(norm(p.name))))
    : ctx.current;
  if (!project) {
    return wanted
      ? `Projet introuvable. Projets : ${ctx.all.map((p) => p.name).join(", ") || "aucun"}.`
      : "Aucun projet actif : les marchés et études se font par projet. Fais choisir ou créer le projet (projet_activer / projet_creer), ou passe « projet ».";
  }
  const setupError = "La base n'est pas encore à jour : l'utilisateur doit relancer supabase/schema.sql dans Supabase (SQL Editor).";

  if (name === "marches_lister") {
    const [markets, studies] = await Promise.all([getMarkets(supabase, project.id), latestStudies(supabase, project.id)]);
    const lines = markets.map((m) => {
      const st = studies.find((x) => sameMarket(x, m));
      return `- ${m.label} · pays ${m.country}${m.region ? ` · ${m.region}` : ""} · langue ${m.language}${m.pages?.length ? ` · pages : ${m.pages.join(", ")}` : ""} · étude : ${st ? `${st.status} (${st.date})` : "aucune"}`;
    });
    const orphans = studies.filter((st) => !markets.some((m) => sameMarket(st, m))).map((st) => `- ${st.market} (étude ${st.status} du ${st.date}, marché non déclaré)`);
    return lines.length || orphans.length
      ? `Marchés de « ${project.name} » :\n${[...lines, ...orphans].join("\n")}`
      : `Aucun marché déclaré pour « ${project.name} ». Déduis-les (meta_pages, langue des publications, site) puis enregistre-les avec marches_definir.`;
  }

  if (name === "marches_definir") {
    const list = Array.isArray(args.marches) ? (args.marches as Record<string, unknown>[]) : [];
    const markets: Market[] = [];
    for (const raw of list) {
      const m = cleanMarket(raw);
      if (typeof m === "string") return m;
      if (!markets.some((x) => sameMarket(x, m))) markets.push(m);
    }
    const { error } = await supabase.from("projects").update({ markets, updated_at: new Date().toISOString() }).eq("id", project.id);
    if (error) return /markets/.test(error.message) ? setupError : `Erreur : ${error.message}`;
    return `Marchés de « ${project.name} » enregistrés :\n${markets.map((m) => `- ${m.label} (${m.country}, ${m.language})${m.pages?.length ? ` · ${m.pages.join(", ")}` : ""}`).join("\n") || "(aucun)"}`;
  }

  const market = cleanMarket(args);
  if (typeof market === "string") return market;

  if (name === "etude_marche_lire") {
    const { data, error } = await supabase
      .from("market_studies")
      .select("id, market, country, region, sections, status, error, created_at")
      .eq("project_id", project.id)
      .eq("country", market.country)
      .order("created_at", { ascending: false })
      .limit(10);
    if (error) return setupError;
    const st = (data ?? []).find((x) => !market.region || norm(x.region ?? "") === norm(market.region)) ?? null;
    if (!st) return `Aucune étude de marché pour « ${project.name} » sur ${market.label}. Propose de la lancer (etude_marche_lancer).`;
    const sections = st.sections as Study["sections"];
    const section = String(args.section ?? "tout");
    const keys = section === "tout" ? STEPS.filter((x) => x !== "plan") : ([section] as Step[]);
    const body = keys.map((k) => (sections[k] ? `## ${STEP_LABELS[k]}\n${sections[k]}` : `## ${STEP_LABELS[k]}\n(pas encore fait)`)).join("\n\n");
    return `Étude de marché « ${project.name} » · ${st.market} · ${st.status}${st.error ? ` (erreur : ${st.error})` : ""} · ${String(st.created_at).slice(0, 10)}\n\n${body.slice(0, 30_000)}`;
  }

  // etude_marche_lancer
  const { data: recent, error } = await supabase
    .from("market_studies")
    .select("id, region, status, created_at")
    .eq("project_id", project.id)
    .eq("country", market.country)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) return setupError;
  const same = (recent ?? []).filter((x) => norm(x.region ?? "") === norm(market.region ?? ""));
  const running = same.find((x) => x.status === "en_cours" || x.status === "en_attente");
  if (running) {
    ctx.start(running.id);
    return `Une étude « ${project.name} » · ${market.label} est déjà en cours : elle continue, l'utilisateur sera notifié à la fin (page « Marché »).`;
  }
  const fresh = same.find((x) => x.status === "terminee" && Date.now() - new Date(x.created_at).getTime() < 30 * 86_400_000);
  if (fresh && !args.forcer) {
    return `Une étude « ${project.name} » · ${market.label} existe déjà (du ${String(fresh.created_at).slice(0, 10)}). Utilise etude_marche_lire ; ne relance (forcer) que si l'utilisateur le demande explicitement.`;
  }
  // Sans rien sur ce que vend le projet, l'étude serait inventée : on demande d'abord.
  const offres = String(args.offres ?? "").trim();
  if (!args.site && offres.length < 60 && !(await projectKnowledge(supabase, project.id))) {
    return (
      `Je ne sais pas encore ce que vend « ${project.name} » : ni description, ni mémoire, ni fichier dans le projet. ` +
      `Demande à l'utilisateur ses offres (produits ou services, formules, prix, pour qui) ou son site, ou de joindre sa fiche produit au projet, puis relance avec « offres » ou « site ». Ne lance pas l'étude sans ces informations.`
    );
  }
  const { data: created, error: insErr } = await supabase
    .from("market_studies")
    .insert({
      user_id: ctx.userId,
      project_id: project.id,
      market: market.label,
      country: market.country,
      region: market.region,
      language: market.language,
      inputs: {
        offres: args.offres ? String(args.offres).slice(0, 6000) : undefined,
        site: args.site ? String(args.site) : undefined,
        secteur: args.secteur ? String(args.secteur) : undefined,
        pages: market.pages?.length ? market.pages : undefined,
      },
    })
    .select("id")
    .single();
  if (insErr || !created) return `Erreur : ${insErr?.message}`;

  // Le marché étudié est ajouté aux marchés du projet s'il n'y est pas encore.
  const markets = await getMarkets(supabase, project.id);
  if (!markets.some((m) => sameMarket(m, market))) {
    await supabase.from("projects").update({ markets: [...markets, market] }).eq("id", project.id);
  }
  ctx.start(created.id);
  return (
    `Étude de marché lancée : « ${project.name} » · ${market.label} (langue ${market.language}). Elle tourne en arrière-plan (2 à 5 min) : ` +
    `offres → cibles → besoins → PESTEL → mots-clés Google du pays → sujets. L'utilisateur sera notifié à la fin ; il peut suivre l'avancement dans la page « Marché ».`
  );
}
