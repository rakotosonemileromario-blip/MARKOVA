import { cookies } from "next/headers";
import { requireUser } from "@/lib/supabase/server";
import { generateReport } from "@/lib/report";
import { resolveTimezone, TZ_COOKIE } from "@/lib/timezone";

export const maxDuration = 300;

/** POST — génère le rapport hebdomadaire tout de suite (bouton « Générer maintenant »). */
export async function POST() {
  const auth = await requireUser();
  if (!auth) return Response.json({ error: "Non authentifié" }, { status: 401 });
  const tz = await resolveTimezone(auth.supabase, (await cookies()).get(TZ_COOKIE)?.value);
  try {
    return Response.json(await generateReport(auth.supabase, auth.user.id, tz, "hebdo"));
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
