import { cookies } from "next/headers";
import { requireUser } from "@/lib/supabase/server";
import { runDueFollowups } from "@/lib/followups";
import { resolveTimezone, TZ_COOKIE } from "@/lib/timezone";

export const maxDuration = 300;

/**
 * POST — appelé chaque minute par l'application ouverte (PC ou téléphone) :
 * exécute à l'heure exacte les relances de l'utilisateur arrivées à échéance.
 */
export async function POST() {
  const auth = await requireUser();
  if (!auth) return Response.json({ error: "Non authentifié" }, { status: 401 });
  const { count } = await auth.supabase
    .from("followups")
    .select("id", { count: "exact", head: true })
    .eq("status", "prevue")
    .lte("due_at", new Date().toISOString());
  if (!count) return Response.json({ done: [] });
  const tz = await resolveTimezone(auth.supabase, (await cookies()).get(TZ_COOKIE)?.value);
  const done = await runDueFollowups(auth.supabase, { userId: auth.user.id, timezoneOf: async () => tz, max: 2 });
  return Response.json({ done });
}
