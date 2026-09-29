import { promises as fs } from "fs";
import path from "path";
import type { SupabaseClient } from "@supabase/supabase-js";

export type Skill = {
  id: string;
  name: string;
  source: string;
  role: "core" | "skill";
  description: string;
  keywords: string[];
  always_loaded: boolean;
  prompt: string;
  rules: string;
};

const SKILLS_DIR = path.join(process.cwd(), "skills");

let cache: Skill[] | null = null;

/** Lit toutes les compétences de /skills. Ajouter un dossier = ajouter une compétence. */
export async function loadSkills(): Promise<Skill[]> {
  if (cache && process.env.NODE_ENV === "production") return cache;
  const entries = await fs.readdir(SKILLS_DIR, { withFileTypes: true });
  const skills: Skill[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(SKILLS_DIR, entry.name);
    try {
      const meta = JSON.parse(await fs.readFile(path.join(dir, "skill.json"), "utf8"));
      const prompt = await fs.readFile(path.join(dir, "prompt.md"), "utf8");
      const rules = await fs.readFile(path.join(dir, "rules.md"), "utf8").catch(() => "");
      skills.push({ ...meta, prompt, rules: stripComments(rules) });
    } catch {
      // Dossier incomplet : ignoré.
    }
  }
  cache = skills;
  return skills;
}

/** Compétences du dossier /skills + compétences ajoutées par l'utilisateur (table custom_skills). */
export async function loadAllSkills(supabase: SupabaseClient, userId?: string): Promise<Skill[]> {
  const q = supabase.from("custom_skills").select("id, name, description, keywords, prompt, always_loaded, source_name").eq("active", true);
  const [base, { data: custom }] = await Promise.all([loadSkills(), userId ? q.eq("user_id", userId) : q]);
  const added: Skill[] = (custom ?? []).map((c) => ({
    id: `perso-${String(c.id).slice(0, 8)}`,
    name: String(c.name),
    source: c.source_name ? `Ajoutée (${c.source_name})` : "Ajoutée par l'utilisateur",
    role: "skill",
    description: String(c.description ?? ""),
    keywords: (c.keywords as string[]) ?? [],
    always_loaded: Boolean(c.always_loaded),
    prompt: String(c.prompt),
    rules: "",
  }));
  return [...base, ...added];
}

function stripComments(md: string) {
  return md.replace(/<!--[\s\S]*?-->/g, "").replace(/^﻿/, "").trim();
}

export function normalize(text: string) {
  return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Mot entier (avec pluriel en s/x toléré) : « pub » ne doit pas matcher « publication ». */
function hasWord(text: string, word: string) {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}[sx]?([^a-z0-9]|$)`).test(text);
}

const GLOBAL_TRIGGERS = ["analyse globale", "analyse tout", "analyse complete", "tout analyser"];

export const isGlobalAnalysis = (text: string) => GLOBAL_TRIGGERS.some((t) => normalize(text).includes(t));

// Demandes d'assistant personnel (agenda, mails, tâches…) : aucune méthode marketing à charger.
const ASSISTANT_RE =
  /\b(agenda|calendrier google|rendez-vous|rdv|reunions?|mails?|e-?mails?|gmail|boite|inbox|taches?|todo|drive|briefing|demain|aujourd'?hui|cette semaine|planning du jour)\b/;
const MARKETING_RE =
  /\b(marketing|campagnes?|pubs?|publicites?|ads|cpl|cpa|ctr|cpm|roas|budget|kpi|contenus?|posts?|calendrier editorial|strategie|leads?|conversion|creatifs?|audience|seo|funnel|newsletters?|emailing|sequences?|crm|prospects?|pipeline|sea|analytics|ga4|referencement|mots?-cles?|concurrents?|veille|copywriting|landing|tunnel|cro|marque|branding|positionnement|personas?|reseaux sociaux|community)\b/;

/**
 * Choisit les compétences à charger : le noyau (always_loaded) + les compétences
 * dont les mots-clés apparaissent dans la demande (2 max), ou toutes pour une analyse globale.
 * Une simple demande d'assistant (agenda, mails, tâches) n'en charge aucune : réponse plus rapide.
 */
export function selectSkills(skills: Skill[], text: string, current = text): Skill[] {
  const q = normalize(text);
  const now = normalize(current);
  const core = skills.filter((s) => s.always_loaded);
  const others = skills.filter((s) => !s.always_loaded);

  if (GLOBAL_TRIGGERS.some((t) => q.includes(t))) return [...core, ...others];
  if (ASSISTANT_RE.test(now) && !MARKETING_RE.test(now)) return [];

  const scored = others
    .map((s) => ({ s, score: s.keywords.filter((k) => hasWord(q, normalize(k))).length }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map((x) => x.s);

  return [...core, ...scored];
}
