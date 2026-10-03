import { GoogleGenAI } from "@google/genai";
import { requireUser } from "@/lib/supabase/server";

export const maxDuration = 60;

const MODEL_TIMEOUT_MS = 15_000;

// Vocabulaire que l'utilisateur emploie souvent : aide à reconnaître les termes mal prononcés ou anglais.
const VOCABULARY =
  "Kimia, MARKOVA, Meta, Meta Ads, Facebook, Instagram, TikTok, LinkedIn, Google Ads, Google Analytics, Search Console, Gmail, Drive, Google Sheets, " +
  "CPL, CPA, CPC, CPM, CTR, ROAS, KPI, lead, leads, campagne, ensemble de publicités, budget, créatif, hook, reels, carrousel, story, " +
  "SEO, CRM, newsletter, landing page, funnel, tunnel de vente, retargeting, audience, briefing, tâche, agenda, projet";

/**
 * Transcription audio → texte, adaptée à l'utilisateur : français parlé avec un accent malgache,
 * parfois mélangé de mots malgaches. Le brouillon du navigateur (souvent imparfait) sert d'indice.
 */
export async function POST(req: Request) {
  const auth = await requireUser();
  if (!auth) return Response.json({ error: "Non authentifié" }, { status: 401 });
  if (!process.env.GEMINI_API_KEY) return Response.json({ error: "Transcription indisponible (GEMINI_API_KEY absente)." }, { status: 503 });

  const { data, mimeType, draft } = (await req.json()) as { data?: string; mimeType?: string; draft?: string };
  if (!data) return Response.json({ error: "Audio manquant" }, { status: 400 });

  // Noms propres de l'utilisateur (projets, comptes) : souvent mal reconnus par la dictée du navigateur.
  const [{ data: projects }, { data: integrations }] = await Promise.all([
    auth.supabase.from("projects").select("name").limit(80),
    auth.supabase.from("integrations").select("account_email").limit(10),
  ]);
  const names = [...(projects ?? []).map((p) => p.name), ...(integrations ?? []).map((i) => i.account_email)].filter(Boolean).join(", ");

  const instruction = [
    "Tu transcris un message vocal adressé à Kimia, l'assistante marketing de l'utilisateur.",
    "L'utilisateur parle français, souvent avec un accent (par exemple malgache ou québécois). S'il est malgache : accent malgache (voyelles et « r » différents, certaines consonnes adoucies, rythme propre) et mélange parfois des mots ou phrases en malgache.",
    "Règles :",
    "1. Écris ce qu'il a VOULU dire, en français correct et naturel, en respectant fidèlement le sens et l'ordre des idées. N'ajoute rien, ne résume pas, ne réponds pas à la demande.",
    "2. Les passages en malgache sont traduits en français dans la phrase (sans les signaler).",
    "3. Corrige les mots mal reconnus à cause de l'accent grâce au contexte et au vocabulaire ci-dessous (ex. « si pé elle » → « CPL », « méta » → « Meta »).",
    "4. Chiffres en chiffres (12 €, 3 %, 15 h). Ponctuation correcte.",
    `Vocabulaire fréquent : ${VOCABULARY}.`,
    names ? `Noms propres de l'utilisateur : ${names}.` : "",
    draft ? `Brouillon de la dictée automatique du navigateur (peut contenir des erreurs, sert seulement d'indice) : « ${draft.slice(0, 4000)} »` : "",
    "Réponds UNIQUEMENT par la transcription finale, sans guillemets ni commentaire.",
  ]
    .filter(Boolean)
    .join("\n");

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const models = (process.env.GEMINI_MODELS ?? "gemini-3.1-flash-lite").split(",").map((m) => m.trim()).filter(Boolean);
  for (const model of models) {
    try {
      const r = await Promise.race([
        ai.models.generateContent({
          model,
          contents: [{ role: "user", parts: [{ inlineData: { mimeType: (mimeType || "audio/webm").split(";")[0], data } }, { text: instruction }] }],
          config: { temperature: 0 },
        }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("délai dépassé")), MODEL_TIMEOUT_MS)),
      ]);
      const text = r.text?.trim().replace(/^["«»\s]+|["«»\s]+$/g, "");
      if (text) return Response.json({ text });
    } catch {
      // modèle suivant
    }
  }
  return Response.json({ error: "Transcription impossible pour le moment." }, { status: 502 });
}
