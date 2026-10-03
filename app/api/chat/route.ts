import { requireUser } from "@/lib/supabase/server";
import { isGlobalAnalysis, loadAllSkills, selectSkills } from "@/lib/skills";
import { buildSystemPrompt, GLOBAL_ANALYSIS_PROMPT, VOICE_SUMMARY_PROMPT, type FileContext, type Memory } from "@/lib/agent";
import { generate, type Attachment, type Source, type ToolSet, type Turn } from "@/lib/llm";
import { ACTION_KINDS, describeAction, getGoogleSessions, googleToolDefs, runGoogleTool } from "@/lib/google";
import { getMetaSession, META_ACTION_KINDS, META_TOOLS, prepareMetaAction, runMetaTool } from "@/lib/meta";
import { BRAND_TOOLS, getBrandVoice, runBrandTool } from "@/lib/brand";
import { runVeilleTool, VEILLE_TOOLS } from "@/lib/veille";
import { isMetaAction, proposeActionTool } from "@/lib/actions";
import { hasWebSearchProvider, searchWeb, webResultsToPrompt, webResultsToSources } from "@/lib/websearch";
import { runWebTool, WEB_TOOLS } from "@/lib/webtools";
import { cookies } from "next/headers";
import { getProjectContext, linkedProjects, PROJECT_COOKIE, PROJECT_TOOLS, runProjectTool } from "@/lib/projects";
import { resolveTimezone, TZ_COOKIE } from "@/lib/timezone";
import { listWatchRules, runWatchTool, WATCH_TOOLS } from "@/lib/watch-tools";
import { describeRule } from "@/lib/monitor";
import { FOLLOWUP_TOOLS, runFollowupTool } from "@/lib/followups";

type ProposedAction = { id: string; kind: string; account_email: string; summary: string; reason: string | null; status: string };

export const maxDuration = 60;

const HISTORY_LIMIT = 30;
const MAX_INLINE_BYTES = 15 * 1024 * 1024;

type Body = { conversationId?: string; message?: string; fileIds?: string[]; webSearch?: boolean; voice?: boolean };

export async function POST(req: Request) {
  const auth = await requireUser();
  if (!auth) return Response.json({ error: "Non authentifié" }, { status: 401 });
  const { supabase, user } = auth;

  const body = (await req.json()) as Body;
  const message = body.message?.trim();
  if (!message) return Response.json({ error: "Message vide" }, { status: 400 });
  const webSearch = Boolean(body.webSearch);

  // ─── Projet actif ──────────────────────────────────────────────
  const cookieStore = await cookies();
  const cookieProject = cookieStore.get(PROJECT_COOKIE)?.value ?? null;
  // Fuseau de l'appareil utilisé (PC ou téléphone).
  const timezone = await resolveTimezone(supabase, cookieStore.get(TZ_COOKIE)?.value);

  // ─── Conversation ──────────────────────────────────────────────
  // Une conversation existante garde son projet ; une nouvelle prend le projet actif.
  let conversationId = body.conversationId;
  let fileIds: string[] = [];
  let projectId: string | null = cookieProject;
  if (conversationId) {
    const { data, error } = await supabase.from("conversations").select("id, file_ids, project_id").eq("id", conversationId).single();
    if (error || !data) return Response.json({ error: "Conversation introuvable" }, { status: 404 });
    fileIds = data.file_ids ?? [];
    projectId = data.project_id;
  }
  const projects = await getProjectContext(supabase, projectId);
  const linked = linkedProjects(projects.current, projects.all);

  if (!conversationId) {
    const { data, error } = await supabase
      .from("conversations")
      .insert({ title: message.slice(0, 70), project_id: projects.current?.id ?? null })
      .select("id")
      .single();
    if (error || !data) return Response.json({ error: error?.message ?? "Création impossible" }, { status: 500 });
    conversationId = data.id as string;
  }

  const newFileIds = (body.fileIds ?? []).filter((id) => !fileIds.includes(id));
  if (newFileIds.length) {
    fileIds = [...fileIds, ...newFileIds];
    await supabase.from("conversations").update({ file_ids: fileIds }).eq("id", conversationId);
  }

  await supabase.from("messages").insert({
    conversation_id: conversationId,
    role: "user",
    content: message,
    meta: newFileIds.length ? { fileIds: newFileIds } : {},
  });

  // ─── Contexte ──────────────────────────────────────────────────
  const [historyRes, memoriesRes, filesRes, allSkills] = await Promise.all([
    supabase
      .from("messages")
      .select("role, content")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(HISTORY_LIMIT),
    // Mémoire : générale (sans projet) + projet actif + projets liés (parent, sous-projets, complémentaires).
    (() => {
      const q = supabase.from("memories").select("category, skill, content, project_id").eq("active", true).order("created_at");
      const ids = [projects.current?.id, ...linked.map((l) => l.project.id)].filter(Boolean);
      return ids.length ? q.or(`project_id.is.null,project_id.in.(${ids.join(",")})`) : q.is("project_id", null);
    })(),
    fileIds.length
      ? supabase.from("files").select("id, name, kind, mime_type, size_bytes, storage_path, extracted_text, kpi_summary, status, error").in("id", fileIds)
      : Promise.resolve({ data: [] as never[] }),
    loadAllSkills(supabase),
  ]);

  const turns: Turn[] = (historyRes.data ?? [])
    .reverse()
    .map((m) => ({ role: m.role as Turn["role"], text: m.content as string }));
  // Gemini exige que l'historique commence par un message utilisateur.
  while (turns.length && turns[0].role !== "user") turns.shift();

  const files = filesRes.data ?? [];
  const fileContexts: FileContext[] = files.map((f) => ({
    name: f.name,
    kind: f.kind,
    text: f.extracted_text,
    kpi: f.kpi_summary,
    note: f.status === "erreur" ? `Extraction échouée : ${f.error}` : f.error,
  }));

  // Images et PDF scannés : envoyés tels quels au modèle (vision).
  const attachments: Attachment[] = [];
  let inlineBytes = 0;
  for (const f of files) {
    const visual = f.kind === "image" || (f.kind === "pdf" && !f.extracted_text);
    if (!visual || inlineBytes + f.size_bytes > MAX_INLINE_BYTES) continue;
    const { data } = await supabase.storage.from("files").download(f.storage_path);
    if (!data) continue;
    inlineBytes += f.size_bytes;
    attachments.push({ name: f.name, mimeType: f.mime_type, data: Buffer.from(await data.arrayBuffer()).toString("base64") });
  }
  if (attachments.length && turns.length) turns[turns.length - 1].attachments = attachments;

  // Sélection des compétences sur la demande + le message utilisateur précédent (suivi de contexte).
  const previousUser = turns.filter((t) => t.role === "user").slice(-2, -1)[0]?.text ?? "";
  const activeSkills = selectSkills(allSkills, `${message}\n${previousUser}`, message);

  const [googleAccounts, meta, watchRules, brandVoice, competitors] = await Promise.all([
    getGoogleSessions(supabase, { timezone }).catch(() => []),
    getMetaSession(supabase).catch(() => null),
    listWatchRules(supabase).catch(() => []),
    getBrandVoice(supabase, projects.current, projects.all).catch(() => null),
    supabase
      .from("competitors")
      .select("name")
      .eq("active", true)
      .order("name")
      .then((r) => (r.data ?? []).map((c) => String(c.name))),
  ]);

  // Actions proposées pendant ce tour : enregistrées « en attente », jamais exécutées ici.
  const proposedActions: ProposedAction[] = [];
  let emit: (obj: unknown) => void = () => {};
  async function proposeActions(args: Record<string, unknown>): Promise<string> {
    // Accepte { actions: [...] } ou une action seule (certains modèles l'envoient à plat).
    const list = Array.isArray(args.actions) ? (args.actions as Record<string, unknown>[]) : [args];
    const results = [];
    for (const a of list) results.push(await proposeAction(a));
    return results.join("\n");
  }

  async function proposeAction(args: Record<string, unknown>): Promise<string> {
    const kind = String(args.type ?? "");
    let params = (args.params as Record<string, unknown>) ?? {};
    let accountLabel = "";
    let summary = "";

    if (isMetaAction(kind)) {
      // Meta Ads : libellé construit à partir du vrai nom et du budget actuel de l'objet.
      if (!meta) return "Meta n'est pas connecté.";
      if (!(META_ACTION_KINDS as readonly string[]).includes(kind)) return `Type d'action inconnu : ${kind}.`;
      try {
        ({ summary, params } = await prepareMetaAction(meta, kind, params));
      } catch (err) {
        return `Action impossible : ${err instanceof Error ? err.message : err}. Vérifie les identifiants avec ${kind.startsWith("meta_audience_") ? "meta_audiences" : "meta_performances"}.`;
      }
      accountLabel = `Meta · ${meta.name}`;
    } else {
      if (!(ACTION_KINDS as readonly string[]).includes(kind)) return `Type d'action inconnu : ${kind}.`;
      // Compte : celui indiqué, sinon celui qui contient réellement la tâche (ou l'unique compte).
      const wanted = String(args.compte ?? "").toLowerCase();
      const candidates = googleAccounts.filter((a) => a.email.toLowerCase() === wanted);
      const pool = candidates.length ? candidates : googleAccounts;
      let lastError = "";
      for (const acc of pool) {
        try {
          summary = await describeAction(acc, kind, params);
          accountLabel = acc.email;
          break;
        } catch (err) {
          // élément absent de ce compte : on essaie le suivant (en gardant la raison)
          lastError = err instanceof Error ? err.message : String(err);
        }
      }
      if (!accountLabel) {
        return kind.startsWith("sheets_")
          ? `Action Sheets impossible : ${lastError}. Vérifie fichier_id avec drive_rechercher et le format de « lignes ».`
          : `Tâche introuvable (${JSON.stringify(params)}). Relis la liste avec taches_lister et réessaie.`;
      }
      if (kind.endsWith("_creer") && !candidates.length && googleAccounts.length > 1) {
        return `Précise le « compte » Google pour cette création : ${googleAccounts.map((a) => a.email).join(", ")}.`;
      }
    }

    const { data, error } = await supabase
      .from("actions")
      .insert({
        conversation_id: conversationId,
        kind,
        account_email: accountLabel,
        params,
        summary,
        reason: args.motif ? String(args.motif) : null,
      })
      .select("id, kind, account_email, summary, reason, status")
      .single();
    if (error || !data) return `Impossible d'enregistrer l'action : ${error?.message}`;
    proposedActions.push(data);
    emit({ t: "action", v: data });
    return `« ${data.summary} » enregistrée, EN ATTENTE : l'utilisateur doit cliquer sur « Confirmer ». Pas encore faite ; ne dis pas le contraire.`;
  }

  // Pages et recherches Web consultées par l'agent : affichées comme sources sous la réponse.
  const toolSources: Source[] = [];
  const addSources = (list: Source[]) => {
    for (const s of list) if (!toolSources.some((x) => x.uri === s.uri)) toolSources.push(s);
    emit({ t: "sources", v: toolSources });
  };

  const proposeTool = proposeActionTool({ google: googleAccounts.length > 0, meta: Boolean(meta) });
  const tools: ToolSet = {
    defs: [
      ...WEB_TOOLS,
      ...PROJECT_TOOLS,
      ...WATCH_TOOLS,
      ...FOLLOWUP_TOOLS,
      ...BRAND_TOOLS,
      ...VEILLE_TOOLS,
      ...(googleAccounts.length ? googleToolDefs(googleAccounts) : []),
      ...(meta ? META_TOOLS : []),
      ...(proposeTool ? [proposeTool] : []),
    ],
    run: async (name, args) => {
      const web = await runWebTool(name, args, addSources);
      if (web !== null) return web;
      // Création / liaison / changement de projet : le navigateur rafraîchit son menu Projet.
      const proj = await runProjectTool(supabase, name, args, (activate) => emit({ t: "projects", v: activate ?? null }));
      if (proj !== null) return proj;
      const watch = await runWatchTool(supabase, name, args);
      if (watch !== null) return watch;
      const followup = await runFollowupTool(supabase, name, args, { conversationId: conversationId!, timezone });
      if (followup !== null) return followup;
      const brand = await runBrandTool(supabase, name, args, projects);
      if (brand !== null) return brand;
      const veille = await runVeilleTool(supabase, name, args, { userId: user.id, projectId: projects.current?.id ?? null, timezone });
      if (veille !== null) return veille;
      if (name === "proposer_action") return proposeActions(args);
      if (meta) {
        const m = await runMetaTool(meta, name, args);
        if (m !== null) return m;
      }
      return runGoogleTool(googleAccounts, name, args);
    },
  };

  const projectName = (id: string | null) => projects.all.find((p) => p.id === id)?.name ?? null;
  let system = buildSystemPrompt({
    allSkills,
    activeSkills,
    memories: ((memoriesRes.data ?? []) as (Memory & { project_id: string | null })[]).map((m) => ({
      ...m,
      project: m.project_id && m.project_id !== projects.current?.id ? projectName(m.project_id) : null,
    })),
    files: fileContexts,
    webSearch,
    timezone,
    google: googleAccounts.length ? { emails: googleAccounts.map((a) => a.email) } : null,
    meta: meta ? { name: meta.name } : null,
    watchRules: watchRules.map((r) => describeRule(r)),
    brandVoice,
    competitors,
    project: {
      current: projects.current,
      linked: linked.map((l) => ({ name: l.project.name, description: l.project.description, relation: l.relation })),
      all: projects.all.map((p) => p.name),
    },
  });

  // Question posée au micro : la réponse se termine par un résumé d'actions à lire à voix haute.
  if (body.voice) system += VOICE_SUMMARY_PROMPT;
  // « Analyse globale » : toutes les sources, structure État actuel / Problèmes / Priorités / Actions.
  if (isGlobalAnalysis(message)) system += GLOBAL_ANALYSIS_PROMPT;

  // Recherche Web : Tavily si configuré (marche avec tous les modèles), sinon recherche Google intégrée à Gemini.
  let webSources: Source[] = [];
  let webNotice: string | null = null;
  let geminiSearch = webSearch;
  if (webSearch && hasWebSearchProvider()) {
    geminiSearch = false;
    try {
      const results = await searchWeb(message);
      system += webResultsToPrompt(results);
      webSources = webResultsToSources(results);
    } catch (err) {
      webNotice = `Recherche Web indisponible (${err instanceof Error ? err.message : err}).`;
    }
  }

  // ─── Streaming NDJSON ──────────────────────────────────────────
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      emit = send;
      send({ t: "start", conversationId, skills: activeSkills.map((s) => s.id) });

      let text = "";
      let model = "";
      let sources: Source[] = webSources;
      toolSources.push(...webSources);
      const notices: string[] = [];
      const toolsUsed: string[] = [];
      if (webNotice) {
        notices.push(webNotice);
        send({ t: "notice", v: webNotice });
      }
      if (sources.length) send({ t: "sources", v: sources });
      try {
        for await (const ev of generate({ system, turns, webSearch: geminiSearch, tools })) {
          if (ev.type === "tool") {
            toolsUsed.push(ev.label);
            send({ t: "tool", v: ev.label });
          } else if (ev.type === "text") {
            text += ev.text;
            send({ t: "text", v: ev.text });
          } else if (ev.type === "model") {
            model = ev.model;
            send({ t: "model", v: model });
          } else if (ev.type === "notice") {
            notices.push(ev.text);
            send({ t: "notice", v: ev.text });
          } else if (ev.type === "sources") {
            sources = ev.sources;
            send({ t: "sources", v: sources });
          }
        }
        if (toolSources.length > sources.length) sources = toolSources;
        const meta = { model, skills: activeSkills.map((s) => s.id), sources, notices, tools: toolsUsed, actions: proposedActions };
        const { data: saved } = await supabase
          .from("messages")
          .insert({ conversation_id: conversationId, role: "assistant", content: text, meta })
          .select("id")
          .single();
        await supabase.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversationId);
        send({ t: "done", id: saved?.id });
      } catch (err) {
        send({ t: "error", v: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}
