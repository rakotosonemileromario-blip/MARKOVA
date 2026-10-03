import { adminConfigured, createAdminClient } from "@/lib/supabase/admin";
import { cronAuthorized } from "@/lib/cron";
import { runDueFollowups } from "@/lib/followups";
import { resolveTimezone } from "@/lib/timezone";
import { resumeStalledStudies } from "@/lib/market";

export const maxDuration = 300;

/**
 * Relances arrivées à échéance, pour tous les utilisateurs, même application fermée.
 * Déclenchée par GitHub Actions (toutes les 30 min) ou un service externe type cron-job.org (toutes les 5 min).
 * Reprend aussi les études de marché interrompues (délai dépassé).
 */
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return Response.json({ error: "Non autorisé" }, { status: 401 });
  if (!adminConfigured()) return Response.json({ error: "SUPABASE_SERVICE_ROLE_KEY manquant" }, { status: 500 });
  const started = Date.now();
  const admin = createAdminClient();
  const done = await runDueFollowups(admin, { timezoneOf: (userId) => resolveTimezone(admin, null, userId), max: 5 });
  const etudes = await resumeStalledStudies(admin, started + 290_000).catch(() => []);
  return Response.json({ ok: true, done: done.length, etudes });
}
