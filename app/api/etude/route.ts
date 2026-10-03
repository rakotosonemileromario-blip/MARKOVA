import { after } from "next/server";
import { cookies } from "next/headers";
import { requireUser } from "@/lib/supabase/server";
import { getProjectContext, PROJECT_COOKIE } from "@/lib/projects";
import { runMarketTool, runStudy } from "@/lib/market";

// 300 s : l'étude tourne après la réponse (lancer) ou pendant la requête (reprendre).
export const maxDuration = 300;

type Body = { action?: "lancer" | "reprendre"; id?: string; projectId?: string } & Record<string, unknown>;

/** Page « Marché » : lancer une étude, ou reprendre une étude interrompue. */
export async function POST(req: Request) {
  const startedAt = Date.now();
  const auth = await requireUser();
  if (!auth) return Response.json({ error: "Non authentifié" }, { status: 401 });
  const { supabase, user } = auth;
  const body = (await req.json().catch(() => ({}))) as Body;
  const deadline = startedAt + maxDuration * 1000 - 10_000;

  if (body.action === "reprendre" && body.id) {
    return Response.json({ status: await runStudy(supabase, body.id, deadline) });
  }
  if (body.action === "lancer") {
    const projects = await getProjectContext(supabase, body.projectId ?? (await cookies()).get(PROJECT_COOKIE)?.value);
    const text = await runMarketTool(supabase, "etude_marche_lancer", body, {
      userId: user.id,
      current: projects.current,
      all: projects.all,
      start: (id) => after(() => runStudy(supabase, id, deadline).catch(() => "erreur")),
    });
    return Response.json({ text });
  }
  return Response.json({ error: "Action inconnue" }, { status: 400 });
}
