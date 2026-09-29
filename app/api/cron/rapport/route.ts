import { adminConfigured, createAdminClient } from "@/lib/supabase/admin";
import { cronAuthorized, cronUsers } from "@/lib/cron";
import { generateReport } from "@/lib/report";

export const maxDuration = 300;

/** Tâche planifiée du lundi : rapport marketing hebdomadaire pour chaque utilisateur qui l'a activé. */
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return Response.json({ error: "Non autorisé" }, { status: 401 });
  if (!adminConfigured()) return Response.json({ error: "SUPABASE_SERVICE_ROLE_KEY manquant" }, { status: 500 });
  const admin = createAdminClient();
  const report = [];
  for (const u of (await cronUsers(admin)).filter((x) => x.weeklyReport)) {
    try {
      const r = await generateReport(admin, u.id, u.timezone, "hebdo");
      report.push({ user: u.id.slice(0, 8), conversation: r.conversationId, model: r.model });
    } catch (err) {
      report.push({ user: u.id.slice(0, 8), erreur: err instanceof Error ? err.message : String(err) });
    }
  }
  return Response.json({ ok: true, report });
}
