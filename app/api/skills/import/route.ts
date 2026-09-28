import { requireUser } from "@/lib/supabase/server";
import { detectKind, extractContent } from "@/lib/files";
import { generate } from "@/lib/llm";

export const maxDuration = 60;

const MAX_PROMPT_CHARS = 60_000;

/**
 * POST multipart : file (txt, md, csv, pdf, docx, xlsx) et/ou text, name?, always_loaded?
 * Crée une compétence personnelle. Nom, description et mots-clés sont déduits par l'IA s'ils manquent.
 */
export async function POST(req: Request) {
  const auth = await requireUser();
  if (!auth) return Response.json({ error: "Non authentifié" }, { status: 401 });

  const form = await req.formData();
  const file = form.get("file");
  let text = String(form.get("text") ?? "").trim();
  let sourceName: string | null = null;

  if (file instanceof File && file.size > 0) {
    sourceName = file.name;
    const kind = detectKind(file.name, file.type);
    if (kind === "image" || kind === "autre") {
      return Response.json({ error: "Format non pris en charge : utilise TXT, MD, CSV, PDF, DOCX ou XLSX." }, { status: 400 });
    }
    try {
      const r = await extractContent(file.name, kind, new Uint8Array(await file.arrayBuffer()));
      text = [text, r.text].filter(Boolean).join("\n\n").trim();
    } catch (err) {
      return Response.json({ error: `Lecture du fichier impossible : ${err instanceof Error ? err.message : err}` }, { status: 422 });
    }
  }
  if (text.length < 30) return Response.json({ error: "Contenu trop court pour être une compétence." }, { status: 400 });
  text = text.replace(/^\[PDF — \d+ pages\]\n/, "").slice(0, MAX_PROMPT_CHARS);

  const meta = await describeSkill(text).catch(() => null);
  const name = String(form.get("name") ?? "").trim() || meta?.nom || sourceName?.replace(/\.[^.]+$/, "") || "Nouvelle compétence";

  const { data, error } = await auth.supabase
    .from("custom_skills")
    .insert({
      name,
      description: meta?.description ?? text.slice(0, 200),
      keywords: meta?.mots_cles ?? [],
      prompt: text,
      always_loaded: form.get("always_loaded") === "true",
      source_name: sourceName,
    })
    .select("id, name, description, keywords, always_loaded, active, source_name, created_at")
    .single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data);
}

type SkillMeta = { nom: string; description: string; mots_cles: string[] };

/** Demande à l'IA un nom, une description et des mots-clés de déclenchement pour la compétence. */
async function describeSkill(text: string): Promise<SkillMeta | null> {
  const system =
    "Tu analyses une méthode de travail (prompt) destinée à un agent marketing. Réponds UNIQUEMENT par un JSON sur une ligne : " +
    '{"nom": "nom court de la compétence (2-4 mots)", "description": "ce qu\'elle fait, une phrase", "mots_cles": ["8 à 15 mots ou expressions courtes, en minuscules, qu\'un utilisateur emploierait pour demander ce type de travail"]}';
  let out = "";
  for await (const ev of generate({ system, turns: [{ role: "user", text: text.slice(0, 8000) }], webSearch: false })) {
    if (ev.type === "text") out += ev.text;
  }
  const json = out.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return null;
  const m = JSON.parse(json) as SkillMeta;
  return {
    nom: String(m.nom ?? "").slice(0, 60),
    description: String(m.description ?? "").slice(0, 300),
    mots_cles: Array.isArray(m.mots_cles) ? m.mots_cles.map((k) => String(k).toLowerCase().trim()).filter(Boolean).slice(0, 20) : [],
  };
}
