import { cookies } from "next/headers";
import { requireUser } from "@/lib/supabase/server";
import { runSurveillance } from "@/lib/monitor";
import { resolveTimezone, TZ_COOKIE } from "@/lib/timezone";

export const maxDuration = 60;

/** POST — bouton « Vérifier maintenant » : lance la surveillance pour l'utilisateur connecté. */
export async function POST() {
  const auth = await requireUser();
  if (!auth) return Response.json({ error: "Non authentifié" }, { status: 401 });
  const tz = await resolveTimezone(auth.supabase, (await cookies()).get(TZ_COOKIE)?.value);
  try {
    return Response.json(await runSurveillance(auth.supabase, auth.user.id, tz));
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
