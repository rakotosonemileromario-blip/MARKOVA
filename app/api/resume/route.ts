import { requireUser } from "@/lib/supabase/server";
import { generate } from "@/lib/llm";

export const maxDuration = 30;

const SYSTEM = `Tu transformes une réponse écrite de Kimia (assistante marketing) en RÉSUMÉ À LIRE À VOIX HAUTE.
- 50 à 120 mots maximum, en français parlé, phrases courtes, tutoiement.
- Dis seulement l'essentiel : la conclusion, les chiffres clés, puis ce qu'il faut faire maintenant.
- Aucun markdown, aucune liste, aucun emoji, aucun lien, aucune étiquette entre crochets, aucun tableau.
- Chiffres écrits pour l'oral (« 12 euros », « 3 pour cent »).
- Termine, si c'est utile, par « Le détail est affiché à l'écran. »
Réponds uniquement par le texte à lire.`;

/** POST { text } → résumé parlé d'une réponse (quand elle n'a pas de bloc vocal). */
export async function POST(req: Request) {
  if (!(await requireUser())) return Response.json({ error: "Non authentifié" }, { status: 401 });
  const { text } = (await req.json().catch(() => ({}))) as { text?: string };
  if (!text?.trim()) return Response.json({ error: "Texte manquant" }, { status: 400 });

  // Les graphiques et tuiles (JSON) n'ont pas de sens à l'oral : on les retire avant de résumer.
  const clean = text.replace(/```[\s\S]*?(```|$)/g, " ").slice(0, 15_000);
  let out = "";
  try {
    for await (const ev of generate({ system: SYSTEM, turns: [{ role: "user", text: clean }], webSearch: false })) {
      if (ev.type === "text") out += ev.text;
    }
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
  return Response.json({ text: out.trim() });
}
