import { requireUser } from "@/lib/supabase/server";
import { isValidTimezone } from "@/lib/timezone";

/** POST { timezone?, weekly_report? } — réglages de l'utilisateur (fuseau de l'appareil, rapport hebdo). */
export async function POST(req: Request) {
  const auth = await requireUser();
  if (!auth) return Response.json({ error: "Non authentifié" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { timezone?: string; weekly_report?: boolean };

  const row: Record<string, unknown> = { user_id: auth.user.id, updated_at: new Date().toISOString() };
  if (body.timezone !== undefined) {
    if (!isValidTimezone(body.timezone)) return Response.json({ error: "Fuseau invalide" }, { status: 400 });
    row.timezone = body.timezone;
  }
  if (typeof body.weekly_report === "boolean") row.weekly_report = body.weekly_report;

  const { error } = await auth.supabase.from("user_settings").upsert(row, { onConflict: "user_id" });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
