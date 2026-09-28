import { GoogleGenAI } from "@google/genai";
import { requireUser } from "@/lib/supabase/server";

export const maxDuration = 60;

/** Transcription audio → texte (repli quand le navigateur n'a pas de reconnaissance vocale). */
export async function POST(req: Request) {
  if (!(await requireUser())) return Response.json({ error: "Non authentifié" }, { status: 401 });
  if (!process.env.GEMINI_API_KEY) return Response.json({ error: "Transcription indisponible (GEMINI_API_KEY absente)." }, { status: 503 });

  const { data, mimeType } = (await req.json()) as { data?: string; mimeType?: string };
  if (!data) return Response.json({ error: "Audio manquant" }, { status: 400 });

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const models = (process.env.GEMINI_MODELS ?? "gemini-3.1-flash-lite").split(",").map((m) => m.trim());
  for (const model of models) {
    try {
      const r = await ai.models.generateContent({
        model,
        contents: [
          {
            role: "user",
            parts: [
              { inlineData: { mimeType: (mimeType || "audio/webm").split(";")[0], data } },
              { text: "Transcris exactement ce message vocal en français. Réponds uniquement par la transcription, sans commentaire." },
            ],
          },
        ],
      });
      const text = r.text?.trim();
      if (text) return Response.json({ text });
    } catch {
      // modèle suivant
    }
  }
  return Response.json({ error: "Transcription impossible pour le moment." }, { status: 502 });
}
