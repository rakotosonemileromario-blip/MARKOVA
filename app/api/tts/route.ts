import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { requireUser } from "@/lib/supabase/server";
import { DEFAULT_VOICE, isVoice } from "@/lib/voices";

export const maxDuration = 60;

/** POST { text, voice? } → audio MP3 lu par Kimia (voix neuronale gratuite). */
export async function POST(req: Request) {
  if (!(await requireUser())) return Response.json({ error: "Non authentifié" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { text?: string; voice?: string };
  const text = String(body.text ?? "").replace(/\s+/g, " ").trim().slice(0, 3000);
  if (!text) return Response.json({ error: "Texte manquant" }, { status: 400 });
  const voice = isVoice(body.voice) ? body.voice : DEFAULT_VOICE;

  const tts = new MsEdgeTTS();
  try {
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(text, { rate: "+4%" });
    const chunks: Buffer[] = [];
    await Promise.race([
      (async () => {
        for await (const c of audioStream) chunks.push(c as Buffer);
      })(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("délai dépassé")), 25_000)),
    ]);
    const audio = Buffer.concat(chunks);
    if (audio.length < 1000) throw new Error("audio vide");
    return new Response(new Uint8Array(audio), { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "private, max-age=86400" } });
  } catch (err) {
    // L'interface bascule alors sur la voix du téléphone.
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  } finally {
    tts.close();
  }
}
