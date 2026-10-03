import { adminConfigured, createAdminClient } from "@/lib/supabase/admin";
import { cronAuthorized, cronUsers } from "@/lib/cron";
import { weeklyVeille } from "@/lib/veille";

export const maxDuration = 300;

/** Tâche planifiée du lundi : synthèse de la veille concurrentielle pour chaque utilisateur qui suit des concurrents. */
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return Response.json({ error: "Non autorisé" }, { status: 401 });
  if (!adminConfigured()) return Response.json({ error: "SUPABASE_SERVICE_ROLE_KEY manquant" }, { status: 500 });
  const admin = createAdminClient();
  const report = [];
  for (const u of await cronUsers(admin)) {
    try {
      const r = await weeklyVeille(admin, u.id, u.timezone);
      if (r) report.push({ user: u.id.slice(0, 8), conversation: r.conversationId });
    } catch (err) {
      report.push({ user: u.id.slice(0, 8), erreur: err instanceof Error ? err.message : String(err) });
    }
  }
  return Response.json({ ok: true, report });
}
