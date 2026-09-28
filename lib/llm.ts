import { GoogleGenAI, ApiError, type Content, type FunctionCall, type Part } from "@google/genai";

export type Attachment = { mimeType: string; data: string /* base64 */; name: string };
export type Turn = { role: "user" | "assistant"; text: string; attachments?: Attachment[] };
export type Source = { title: string; uri: string };

/** Outils que l'agent peut appeler (Gmail, Agenda, Drive…). */
export type ToolSet = {
  defs: { name: string; label: string; description: string; parameters: Record<string, unknown> }[];
  run: (name: string, args: Record<string, unknown>) => Promise<string>;
};

export type LlmEvent =
  | { type: "text"; text: string }
  | { type: "model"; model: string }
  | { type: "notice"; text: string }
  | { type: "tool"; name: string; label: string }
  | { type: "sources"; sources: Source[] };

type GenerateInput = { system: string; turns: Turn[]; webSearch: boolean; tools?: ToolSet };

const MAX_TOOL_ROUNDS = 6;

// ─── Gestion des quotas ──────────────────────────────────────────
// Un modèle qui renvoie « quota atteint » est mis de côté quelques minutes
// (par instance serveur) pour ne pas le réessayer à chaque message.
const cooldownUntil = new Map<string, number>();
const COOLDOWN_MS = 5 * 60_000;

function available(model: string) {
  return (cooldownUntil.get(model) ?? 0) < Date.now();
}

function geminiModels() {
  return (process.env.GEMINI_MODELS ?? "gemini-3.1-flash-lite,gemini-3.5-flash-lite")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
}

type Attempt = { id: string; run: () => AsyncGenerator<LlmEvent> };

/** Ordre des moteurs : LLM_ORDER=ollama,gemini (défaut) ou gemini,ollama. */
function engineOrder() {
  return (process.env.LLM_ORDER ?? "ollama,gemini").split(",").map((e) => e.trim());
}

function ollamaAttempts(input: GenerateInput): Attempt[] {
  if (!process.env.OLLAMA_BASE_URL) return [];
  const atts = input.turns.flatMap((t) => t.attachments ?? []);
  // Ollama lit les images (modèle vision) mais pas les PDF : ceux-là vont à Gemini.
  if (atts.some((a) => !a.mimeType.startsWith("image/"))) return [];
  const model = atts.length
    ? process.env.OLLAMA_VISION_MODEL || "gemma4:31b"
    : process.env.OLLAMA_MODEL || "gpt-oss:120b";
  return [{ id: `ollama/${model}`, run: () => ollamaChat(model, input) }];
}

function geminiAttempts(input: GenerateInput): Attempt[] {
  if (!process.env.GEMINI_API_KEY) return [];
  return geminiModels().map((model) => ({ id: model, run: () => geminiWithFallbackSearch(model, input) }));
}

/**
 * Génère une réponse en streaming en essayant les moteurs dans l'ordre (LLM_ORDER).
 * Par défaut : Ollama Cloud (rapide) puis Gemini. Un moteur en échec (quota, surcharge,
 * délai dépassé) est remplacé par le suivant, tant que la réponse n'a pas commencé.
 */
export async function* generate(input: GenerateInput): AsyncGenerator<LlmEvent> {
  const failures: string[] = [];
  const attempts = engineOrder().flatMap((e) => (e === "ollama" ? ollamaAttempts(input) : e === "gemini" ? geminiAttempts(input) : []));
  if (!attempts.length) throw new Error("Aucun moteur IA configuré (GEMINI_API_KEY ou OLLAMA_BASE_URL).");

  for (const attempt of attempts) {
    if (!available(attempt.id)) {
      failures.push(`${attempt.id} : quota atteint récemment`);
      continue;
    }
    let started = false;
    try {
      for await (const ev of attempt.run()) {
        if (ev.type === "notice" && !started) {
          yield ev;
          continue;
        }
        if (!started) {
          started = true;
          if (failures.length) yield { type: "notice", text: `Bascule sur ${attempt.id} (${failures.join(" ; ")}).` };
          yield { type: "model", model: attempt.id };
        }
        yield ev;
      }
      if (started) return;
      failures.push(`${attempt.id} : réponse vide`);
    } catch (err) {
      if (started) {
        yield { type: "notice", text: `Réponse interrompue (${describe(err)}).` };
        return;
      }
      if (isQuotaError(err)) cooldownUntil.set(attempt.id, Date.now() + COOLDOWN_MS);
      failures.push(`${attempt.id} : ${describe(err)}`);
    }
  }

  throw new Error(`Aucun moteur IA disponible. ${failures.join(" ; ")}`);
}

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function isQuotaError(err: unknown) {
  return (err instanceof ApiError && err.status === 429) || (err instanceof HttpError && (err.status === 429 || err.status === 402));
}

function describe(err: unknown) {
  if (err instanceof ApiError || err instanceof HttpError) {
    if (err.status === 429 || err.status === 402) return "quota gratuit atteint";
    if (err.status === 404) return "modèle introuvable";
    if (err.status === 503) return "serveurs surchargés";
    return `erreur ${err.status}`;
  }
  if (err instanceof Error && err.name === "TimeoutError") return "délai dépassé";
  return err instanceof Error ? err.message : String(err);
}

// ─── Gemini ──────────────────────────────────────────────────────
/** La recherche Google intégrée n'est pas toujours dans le quota gratuit : si refusée, on réessaie sans. */
async function* geminiWithFallbackSearch(model: string, input: GenerateInput): AsyncGenerator<LlmEvent> {
  try {
    yield* geminiRetryBusy(model, input);
  } catch (err) {
    if (!(input.webSearch && err instanceof ApiError && err.status === 429)) throw err;
    yield { type: "notice", text: "Recherche Web Google indisponible sur le quota gratuit : réponse sans recherche." };
    yield* geminiRetryBusy(model, { ...input, webSearch: false });
  }
}

/** Serveurs Gemini surchargés (503) : on réessaie deux fois avant de passer au moteur suivant. */
async function* geminiRetryBusy(model: string, input: GenerateInput): AsyncGenerator<LlmEvent> {
  for (let attempt = 0; ; attempt++) {
    let emitted = false;
    try {
      for await (const ev of geminiRun(model, input)) {
        emitted = true;
        yield ev;
      }
      return;
    } catch (err) {
      if (emitted || attempt >= 2 || !(err instanceof ApiError && err.status === 503)) throw err;
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
}

async function* geminiRun(model: string, { system, turns, webSearch, tools }: GenerateInput): AsyncGenerator<LlmEvent> {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  const contents: Content[] = turns.map((t) => ({
    role: t.role === "assistant" ? "model" : "user",
    parts: [
      ...(t.attachments ?? []).map((a): Part => ({ inlineData: { mimeType: a.mimeType, data: a.data } })),
      { text: t.text },
    ],
  }));

  // La recherche Google intégrée et les outils personnalisés ne se combinent pas : les outils priment.
  const geminiTools = tools?.defs.length
    ? [{ functionDeclarations: tools.defs.map((d) => ({ name: d.name, description: d.description, parametersJsonSchema: d.parameters })) }]
    : webSearch
      ? [{ googleSearch: {} }]
      : undefined;

  const sources = new Map<string, Source>();
  let nudged = false;
  for (let round = 0; round <= MAX_TOOL_ROUNDS + 1; round++) {
    const stream = await ai.models.generateContentStream({
      model,
      contents,
      config: { systemInstruction: system, tools: geminiTools },
    });

    const modelParts: Part[] = [];
    const calls: FunctionCall[] = [];
    let roundText = "";
    for await (const chunk of stream) {
      const cand = chunk.candidates?.[0];
      for (const part of cand?.content?.parts ?? []) {
        modelParts.push(part);
        if (part.functionCall) calls.push(part.functionCall);
        else if (part.text && !part.thought) {
          roundText += part.text;
          yield { type: "text", text: part.text };
        }
      }
      for (const c of cand?.groundingMetadata?.groundingChunks ?? []) {
        if (c.web?.uri) sources.set(c.web.uri, { uri: c.web.uri, title: c.web.title ?? c.web.uri });
      }
    }

    // Arrêt après des outils sans aucun texte : on redemande une réponse (une fois).
    if (!calls.length && !roundText.trim() && round > 0 && tools && !nudged) {
      nudged = true;
      if (modelParts.length) contents.push({ role: "model", parts: modelParts });
      contents.push({ role: "user", parts: [{ text: "Réponds maintenant à l'utilisateur, brièvement, à partir des résultats des outils." }] });
      continue;
    }
    if (!calls.length || !tools || round === MAX_TOOL_ROUNDS) break;

    // On renvoie les parts telles quelles (signatures de raisonnement incluses), puis les résultats.
    contents.push({ role: "model", parts: modelParts });
    for (const call of calls) {
      const name = call.name ?? "";
      yield { type: "tool", name, label: tools.defs.find((d) => d.name === name)?.label ?? name };
    }
    // Les outils demandés dans un même tour s'exécutent en parallèle.
    const results = await Promise.all(calls.map((c) => runTool(tools, c.name ?? "", c.args ?? {})));
    const responses: Part[] = calls.map((c, i) => ({ functionResponse: { id: c.id, name: c.name ?? "", response: { result: results[i] } } }));
    contents.push({ role: "user", parts: responses });
  }
  if (sources.size) yield { type: "sources", sources: [...sources.values()] };
}

async function runTool(tools: ToolSet, name: string, args: Record<string, unknown>) {
  try {
    return await tools.run(name, args);
  } catch (err) {
    return `ERREUR de l'outil ${name} : ${err instanceof Error ? err.message : String(err)}`;
  }
}

// ─── Ollama (local ou Ollama Cloud) ──────────────────────────────
type OllamaMessage = {
  role: string;
  content: string;
  images?: string[];
  tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[];
  tool_name?: string;
};

async function* ollamaChat(model: string, { system, turns, tools }: GenerateInput): AsyncGenerator<LlmEvent> {
  const messages: OllamaMessage[] = [
    { role: "system", content: system },
    ...turns.map((t) => ({
      role: t.role,
      content: t.text,
      images: t.attachments?.filter((a) => a.mimeType.startsWith("image/")).map((a) => a.data),
    })),
  ];
  const ollamaTools = tools?.defs.map((d) => ({
    type: "function",
    function: { name: d.name, description: d.description, parameters: d.parameters },
  }));

  // Les tours d'outils se font sans streaming ; la réponse finale est streamée.
  // gpt-oss : raisonnement court = réponses nettement plus rapides.
  const think = /gpt-oss/.test(model) ? { think: "low" } : {};

  // Chaque tour est streamé : le texte s'affiche dès qu'il arrive ; si le modèle
  // demande des outils, on les exécute puis on relance un tour.
  let usedTools = false;
  let nudged = false;
  for (let round = 0; round <= MAX_TOOL_ROUNDS + 1; round++) {
    const withTools = Boolean(tools) && round < MAX_TOOL_ROUNDS && !nudged;
    const res = await ollamaFetch({ model, messages, stream: true, ...(withTools ? { tools: ollamaTools } : {}), ...think }, 60_000);
    const assistant: OllamaMessage = { role: "assistant", content: "", tool_calls: [] };
    for await (const chunk of ndjson(res)) {
      const m = chunk.message;
      if (!m) continue;
      if (m.content) {
        assistant.content += m.content;
        yield { type: "text", text: m.content };
      }
      if (m.tool_calls?.length) assistant.tool_calls!.push(...m.tool_calls);
    }
    const calls = assistant.tool_calls!;
    if (!calls.length || !tools || nudged) {
      // Le modèle s'est arrêté après des outils sans rien écrire : on lui redemande une réponse (une fois).
      if (!assistant.content.trim() && usedTools && !nudged) {
        nudged = true;
        messages.push({ role: "user", content: "Réponds maintenant à l'utilisateur, brièvement, à partir des résultats des outils." });
        continue;
      }
      return;
    }

    usedTools = true;
    messages.push(assistant);
    for (const tc of calls) {
      const name = tc.function.name;
      yield { type: "tool", name, label: tools.defs.find((d) => d.name === name)?.label ?? name };
    }
    // Les outils demandés dans un même tour s'exécutent en parallèle.
    const results = await Promise.all(calls.map((tc) => runTool(tools, tc.function.name, tc.function.arguments ?? {})));
    calls.forEach((tc, i) => messages.push({ role: "tool", tool_name: tc.function.name, content: results[i] }));
  }
}

async function* ndjson(res: Response): AsyncGenerator<{ message?: OllamaMessage; error?: string }> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const msg = JSON.parse(line) as { message?: OllamaMessage; error?: string };
      if (msg.error) throw new Error(msg.error);
      yield msg;
    }
  }
}

async function ollamaFetch(body: Record<string, unknown>, timeoutMs: number) {
  const res = await fetch(`${process.env.OLLAMA_BASE_URL!.replace(/\/$/, "")}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Ollama Cloud (https://ollama.com) exige une clé ; une instance locale n'en a pas besoin.
      ...(process.env.OLLAMA_API_KEY ? { Authorization: `Bearer ${process.env.OLLAMA_API_KEY}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok || !res.body) throw new HttpError(res.status, `HTTP ${res.status}`);
  return res;
}
