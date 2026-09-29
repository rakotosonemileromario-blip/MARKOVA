import type { SupabaseClient } from "@supabase/supabase-js";
import { buildSystemPrompt, GLOBAL_ANALYSIS_PROMPT, type Memory } from "./agent";
import { generate, type ToolSet } from "./llm";
import { getGoogleSessions, googleToolDefs, runGoogleTool, todayIn } from "./google";
import { getMetaSession, META_TOOLS, runMetaTool } from "./meta";
import { loadAllSkills } from "./skills";
import { notify } from "./notify";

// Rapport hebdomadaire : généré chaque lundi par la tâche planifiée (ou à la demande),
// enregistré comme une conversation et signalé par une notification « Rapport ».

export const WEEKLY_REPORT_REQUEST =
  "Rapport marketing hebdomadaire : analyse les 7 derniers jours (du lundi au dimanche précédents) avec toutes les sources connectées.";

const REPORT_FORMAT = `
---
# RAPPORT HEBDOMADAIRE AUTOMATIQUE
Tu génères seul le rapport de la semaine écoulée (l'utilisateur n'est pas là pour répondre) : collecte toi-même les données avec les outils
(meta_performances niveau campagne sur « last_7d » puis « last_14d » pour comparer, publications Facebook / Instagram, tâches, agenda de la semaine qui commence),
puis rédige le rapport dans cette structure, avec des blocs kpi / chart quand il y a des chiffres :

## ANALYSE MARKETING — période du … au …
### 🎯 Objectifs (rappel de la mémoire et avancement)
### 📢 Publicités (dépenses, CPM, CTR, CPC, CPL, CPA, ROAS, évolution vs semaine précédente)
### 📱 Réseaux sociaux (publications de la semaine, meilleurs contenus)
### ⚠️ Problèmes (3 max, par ordre d'impact)
### 💡 Opportunités (3 max)
### 🔥 Priorités de la semaine (3 max, avec le pourquoi)
### 🛠️ Ajustements proposés
### 🔐 Actions nécessitant validation (blocs de validation ; l'utilisateur pourra les demander dans la conversation)
### 📅 Semaine qui commence (échéances, rendez-vous, tâches en retard)

Si une source n'est pas connectée ou ne renvoie rien, dis-le en une ligne et continue. Ne recommande aucune modification que les données ne justifient pas.`;

type ReportResult = { conversationId: string; model: string };

/**
 * Génère un rapport complet (hebdomadaire ou analyse globale) pour un utilisateur, sans interaction.
 * supabase peut être le client « service » : toutes les requêtes filtrent par userId.
 */
export async function generateReport(
  supabase: SupabaseClient,
  userId: string,
  timezone: string,
  kind: "hebdo" | "globale" = "hebdo",
): Promise<ReportResult> {
  const [allSkills, memoriesRes, googleAccounts, meta] = await Promise.all([
    loadAllSkills(supabase, userId),
    supabase.from("memories").select("category, skill, content").eq("user_id", userId).eq("active", true).is("project_id", null).order("created_at"),
    getGoogleSessions(supabase, { userId, timezone }).catch(() => []),
    getMetaSession(supabase, userId).catch(() => null),
  ]);

  const tools: ToolSet = {
    defs: [...(googleAccounts.length ? googleToolDefs(googleAccounts) : []), ...(meta ? META_TOOLS : [])],
    run: async (name, args) => {
      if (meta) {
        const m = await runMetaTool(meta, name, args);
        if (m !== null) return m;
      }
      return runGoogleTool(googleAccounts, name, args);
    },
  };

  const system =
    buildSystemPrompt({
      allSkills,
      activeSkills: allSkills.filter((s) => s.always_loaded || ["media-buying", "analytics"].includes(s.id)),
      memories: (memoriesRes.data ?? []) as Memory[],
      files: [],
      webSearch: false,
      timezone,
      google: googleAccounts.length ? { emails: googleAccounts.map((a) => a.email) } : null,
      meta: meta ? { name: meta.name } : null,
    }) + (kind === "hebdo" ? REPORT_FORMAT : GLOBAL_ANALYSIS_PROMPT);

  const request = kind === "hebdo" ? WEEKLY_REPORT_REQUEST : "Analyse globale";
  let text = "";
  let model = "";
  for await (const ev of generate({ system, turns: [{ role: "user", text: request }], webSearch: false, tools })) {
    if (ev.type === "text") text += ev.text;
    else if (ev.type === "model") model = ev.model;
  }
  if (!text.trim()) throw new Error("le modèle n'a renvoyé aucun texte");

  const date = new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long", timeZone: timezone });
  const title = kind === "hebdo" ? `📊 Rapport hebdo du ${date}` : `🧭 Analyse globale du ${date}`;
  const { data: conv, error } = await supabase.from("conversations").insert({ user_id: userId, title }).select("id").single();
  if (error || !conv) throw new Error(error?.message ?? "conversation non créée");
  await supabase.from("messages").insert([
    { conversation_id: conv.id, user_id: userId, role: "user", content: request },
    { conversation_id: conv.id, user_id: userId, role: "assistant", content: text, meta: { model, automatic: true } },
  ]);

  await notify(supabase, userId, {
    kind: "rapport",
    title: kind === "hebdo" ? "Ton rapport marketing hebdomadaire est prêt" : "Ton analyse globale est prête",
    body: text.replace(/```[\s\S]*?```/g, "").replace(/[#*|>`_-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200),
    link: `/c/${conv.id}`,
    dedupeKey: `${kind}:${todayIn(timezone)}`,
  });
  return { conversationId: conv.id, model };
}
