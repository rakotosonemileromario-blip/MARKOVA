import { cookies } from "next/headers";
import { requireUser } from "@/lib/supabase/server";
import { runVeille, runVeilleTool } from "@/lib/veille";
import { resolveTimezone, TZ_COOKIE } from "@/lib/timezone";
import { PROJECT_COOKIE } from "@/lib/projects";

export const maxDuration = 60;

type Body = { action?: "ajouter" | "verifier" | "supprimer"; id?: string; nom?: string; urls?: string[] };

/** Gestion de la veille depuis la page « Veille » (ajout, vérification immédiate, retrait). */
export async function POST(req: Request) {
  const auth = await requireUser();
  if (!auth) return Response.json({ error: "Non authentifié" }, { status: 401 });
  const { supabase, user } = auth;
  const body = (await req.json().catch(() => ({}))) as Body;
  const cookieStore = await cookies();
  const timezone = await resolveTimezone(supabase, cookieStore.get(TZ_COOKIE)?.value);

  if (body.action === "ajouter") {
    const text = await runVeilleTool(
      supabase,
      "veille_ajouter",
      { nom: body.nom, urls: body.urls },
      { userId: user.id, projectId: cookieStore.get(PROJECT_COOKIE)?.value || null, timezone },
    );
    return Response.json({ text });
  }
  if (body.action === "verifier") {
    const r = await runVeille(supabase, user.id, timezone, { competitorId: body.id, maxPages: 5, budgetMs: 45_000 });
    return Response.json(r);
  }
  if (body.action === "supprimer" && body.id) {
    const { error } = await supabase.from("competitors").delete().eq("id", body.id);
    return error ? Response.json({ error: error.message }, { status: 500 }) : Response.json({ ok: true });
  }
  return Response.json({ error: "Action inconnue" }, { status: 400 });
}
