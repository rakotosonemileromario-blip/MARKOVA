import { adminConfigured, createAdminClient } from "@/lib/supabase/admin";
import { cronAuthorized, cronUsers } from "@/lib/cron";
import { runSurveillance } from "@/lib/monitor";
import { runDueFollowups } from "@/lib/followups";
import { resolveTimezone } from "@/lib/timezone";
import { runVeille } from "@/lib/veille";

export const maxDuration = 300;

/** Tâche planifiée quotidienne : surveillance de tous les utilisateurs (règles KPI, tâches, actions, accès, concurrents). */
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return Response.json({ error: "Non autorisé" }, { status: 401 });
  if (!adminConfigured()) return Response.json({ error: "SUPABASE_SERVICE_ROLE_KEY manquant" }, { status: 500 });
  const admin = createAdminClient();
  const started = Date.now();
  const users = await cronUsers(admin);
  const report = [];
  for (const u of users) {
    try {
      const r = await runSurveillance(admin, u.id, u.timezone);
      report.push({ user: u.id.slice(0, 8), nouvelles: r.nouvelles, erreurs: r.erreurs.length });
    } catch (err) {
      report.push({ user: u.id.slice(0, 8), erreur: err instanceof Error ? err.message : String(err) });
    }
  }
  // Veille concurrentielle : le temps restant est partagé entre les utilisateurs (pages les plus anciennes d'abord).
  const veille = [];
  for (const u of users) {
    const left = 270_000 - (Date.now() - started);
    if (left < 20_000) break;
    try {
      const r = await runVeille(admin, u.id, u.timezone, { budgetMs: Math.min(180_000, left - 15_000) });
      if (r.pages) veille.push({ user: u.id.slice(0, 8), pages: r.pages, changements: r.changements.length, alertes: r.alertes, erreurs: r.erreurs.length });
    } catch (err) {
      veille.push({ user: u.id.slice(0, 8), erreur: err instanceof Error ? err.message : String(err) });
    }
  }
  // Filet de sécurité : relances en retard (si aucun déclencheur fréquent n'est configuré).
  const relances = await runDueFollowups(admin, { timezoneOf: (userId) => resolveTimezone(admin, null, userId), max: 5 }).catch(() => []);
  return Response.json({ ok: true, report, veille, relances: relances.length });
}
