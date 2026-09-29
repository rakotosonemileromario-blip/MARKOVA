import { adminConfigured, createAdminClient } from "@/lib/supabase/admin";
import { cronAuthorized, cronUsers } from "@/lib/cron";
import { runSurveillance } from "@/lib/monitor";
import { runDueFollowups } from "@/lib/followups";
import { resolveTimezone } from "@/lib/timezone";

export const maxDuration = 300;

/** Tâche planifiée quotidienne : surveillance de tous les utilisateurs (règles KPI, tâches, actions, accès). */
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return Response.json({ error: "Non autorisé" }, { status: 401 });
  if (!adminConfigured()) return Response.json({ error: "SUPABASE_SERVICE_ROLE_KEY manquant" }, { status: 500 });
  const admin = createAdminClient();
  const report = [];
  for (const u of await cronUsers(admin)) {
    try {
      const r = await runSurveillance(admin, u.id, u.timezone);
      report.push({ user: u.id.slice(0, 8), nouvelles: r.nouvelles, erreurs: r.erreurs.length });
    } catch (err) {
      report.push({ user: u.id.slice(0, 8), erreur: err instanceof Error ? err.message : String(err) });
    }
  }
  // Filet de sécurité : relances en retard (si aucun déclencheur fréquent n'est configuré).
  const relances = await runDueFollowups(admin, { timezoneOf: (userId) => resolveTimezone(admin, null, userId), max: 5 }).catch(() => []);
  return Response.json({ ok: true, report, relances: relances.length });
}
