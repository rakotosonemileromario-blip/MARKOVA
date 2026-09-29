import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToolSet, Turn } from "./llm";
import { notify } from "./notify";
import { autonomousAgent, runAgent } from "./report";
import { formatLocal, localToUtc } from "./timezone";

// Relances programmées : « rends-moi compte dans 3 h », « à 18 h, dis-moi si le CPL a baissé ».
// À l'heure prévue, MARKOVA exécute la consigne (lecture seule), écrit le compte rendu dans la conversation
// d'origine et envoie une notification.

export const FOLLOWUP_TOOLS: ToolSet["defs"] = [
  {
    name: "relance_programmer",
    label: "⏰ Relance programmée",
    description:
      "Programme un compte rendu automatique plus tard : à l'heure prévue, MARKOVA refait l'analyse demandée avec les données du moment, " +
      "écrit la réponse dans cette conversation et envoie une notification. Utilise-le dès que l'utilisateur dit « dans 3 h », « à 18 h », « demain matin », « rappelle-moi », « rends-moi compte »… " +
      "Donne soit dans_minutes, soit date_heure (heure locale de l'utilisateur).",
    parameters: {
      type: "object",
      properties: {
        dans_minutes: { type: "number", description: "Délai en minutes à partir de maintenant (ex. 180 pour 3 h)" },
        date_heure: { type: "string", description: "Heure locale AAAA-MM-JJTHH:MM (ex. 2026-09-30T08:00)" },
        consigne: {
          type: "string",
          description:
            "Ce que MARKOVA devra faire et rapporter à ce moment-là, rédigé de façon autonome et précise (ex. « Vérifie le CPL des campagnes actives sur aujourd'hui, compare avec ce matin (14,20 €) et dis si la baisse du budget a eu un effet »).",
        },
      },
      required: ["consigne"],
    },
  },
  {
    name: "relance_lister",
    label: "⏰ Relances prévues",
    description: "Liste les relances programmées à venir (avec leur id).",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "relance_annuler",
    label: "⏰ Annulation d'une relance",
    description: "Annule une relance programmée à partir de son id.",
    parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
];

const MAX_DELAY_DAYS = 60;

/** Renvoie null si l'outil n'est pas un outil de relance. */
export async function runFollowupTool(
  supabase: SupabaseClient,
  name: string,
  args: Record<string, unknown>,
  ctx: { conversationId: string; timezone: string },
): Promise<string | null> {
  if (name === "relance_lister") {
    const { data } = await supabase.from("followups").select("id, due_at, instruction").eq("status", "prevue").order("due_at").limit(30);
    return data?.length
      ? data.map((f) => `- id=${f.id} · ${formatLocal(f.due_at, ctx.timezone)} · ${f.instruction}`).join("\n")
      : "Aucune relance prévue.";
  }
  if (name === "relance_annuler") {
    const { data } = await supabase.from("followups").update({ status: "annulee" }).eq("id", String(args.id ?? "")).eq("status", "prevue").select("id");
    return data?.length ? "Relance annulée." : "Relance introuvable ou déjà faite.";
  }
  if (name !== "relance_programmer") return null;

  const instruction = String(args.consigne ?? "").trim();
  if (!instruction) return "Consigne manquante : précise ce qu'il faudra vérifier et rapporter.";
  let due: Date | null = null;
  const minutes = Number(args.dans_minutes);
  if (Number.isFinite(minutes) && minutes > 0) due = new Date(Date.now() + minutes * 60_000);
  else if (typeof args.date_heure === "string") due = localToUtc(args.date_heure, ctx.timezone);
  if (!due || Number.isNaN(due.getTime())) return "Heure invalide : donne dans_minutes ou date_heure au format AAAA-MM-JJTHH:MM.";
  if (due.getTime() < Date.now() - 60_000) return "Cette heure est déjà passée : choisis une heure future.";
  if (due.getTime() > Date.now() + MAX_DELAY_DAYS * 86_400_000) return `Délai trop long (${MAX_DELAY_DAYS} jours maximum).`;

  const { error } = await supabase.from("followups").insert({ conversation_id: ctx.conversationId, due_at: due.toISOString(), instruction });
  if (error) return `Erreur : ${error.message}`;
  return `Relance programmée pour ${formatLocal(due, ctx.timezone)} (fuseau ${ctx.timezone}). À ce moment, MARKOVA écrira le compte rendu dans cette conversation et enverra une notification.`;
}

type Followup = { id: string; user_id: string; conversation_id: string | null; due_at: string; instruction: string; created_at: string };

/**
 * Exécute les relances arrivées à échéance.
 * userId : limite à un utilisateur (bouton / appli ouverte) ; sans userId : tous (tâche planifiée, client service).
 */
export async function runDueFollowups(
  supabase: SupabaseClient,
  opts: { userId?: string; timezoneOf: (userId: string) => Promise<string>; max?: number },
) {
  const q = supabase.from("followups").select("id, user_id, conversation_id, due_at, instruction, created_at").eq("status", "prevue").lte("due_at", new Date().toISOString()).order("due_at").limit(opts.max ?? 3);
  const { data } = await (opts.userId ? q.eq("user_id", opts.userId) : q);
  const done: string[] = [];
  for (const f of (data ?? []) as Followup[]) {
    // Verrou : une seule exécution même si plusieurs déclencheurs passent en même temps.
    const { data: locked } = await supabase.from("followups").update({ status: "en_cours" }).eq("id", f.id).eq("status", "prevue").select("id");
    if (!locked?.length) continue;
    try {
      await executeFollowup(supabase, f, await opts.timezoneOf(f.user_id));
      done.push(f.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await supabase.from("followups").update({ status: "erreur", result: msg, done_at: new Date().toISOString() }).eq("id", f.id);
    }
  }
  return done;
}

async function executeFollowup(supabase: SupabaseClient, f: Followup, timezone: string) {
  const agent = await autonomousAgent(supabase, f.user_id, timezone, ["media-buying", "analytics"]);

  // Contexte : fin de la conversation d'origine, pour que le compte rendu fasse le lien avec ce qui a été dit.
  let turns: Turn[] = [];
  if (f.conversation_id) {
    const { data: msgs } = await supabase
      .from("messages")
      .select("role, content")
      .eq("conversation_id", f.conversation_id)
      .eq("user_id", f.user_id)
      .order("created_at", { ascending: false })
      .limit(8);
    turns = (msgs ?? []).reverse().map((m) => ({ role: m.role as Turn["role"], text: String(m.content).slice(0, 6000) }));
    while (turns.length && turns[0].role !== "user") turns.shift();
    while (turns.length && turns[turns.length - 1].role === "user") turns.pop();
  }
  const asked = formatLocal(f.created_at, timezone);
  turns.push({
    role: "user",
    text:
      `⏰ RELANCE PROGRAMMÉE (demandée le ${asked}, exécutée maintenant). L'utilisateur n'est peut-être pas devant l'écran.\n` +
      `Consigne : ${f.instruction}\n` +
      `Collecte toi-même les données à jour avec les outils, puis fais un compte rendu clair : ce qui a changé depuis la demande, les chiffres (bloc kpi / graphique si pertinent), ta conclusion et la prochaine action. Commence par « ⏰ Compte rendu programmé ».`,
  });

  const { text, model } = await runAgent(agent.system, turns, agent.tools);

  let conversationId = f.conversation_id;
  if (conversationId) {
    await supabase.from("messages").insert({ conversation_id: conversationId, user_id: f.user_id, role: "assistant", content: text, meta: { model, automatic: true, followup: f.id } });
    await supabase.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversationId);
  } else {
    const { data: conv } = await supabase.from("conversations").insert({ user_id: f.user_id, title: `⏰ ${f.instruction.slice(0, 60)}` }).select("id").single();
    conversationId = conv?.id ?? null;
    if (conversationId) await supabase.from("messages").insert({ conversation_id: conversationId, user_id: f.user_id, role: "assistant", content: text, meta: { model, automatic: true, followup: f.id } });
  }
  await supabase.from("followups").update({ status: "faite", result: text.slice(0, 2000), done_at: new Date().toISOString() }).eq("id", f.id);
  await notify(supabase, f.user_id, {
    kind: "rapport",
    title: "⏰ Compte rendu programmé",
    body: f.instruction.slice(0, 200),
    link: conversationId ? `/c/${conversationId}` : "/notifications",
    dedupeKey: `relance:${f.id}`,
  });
}
