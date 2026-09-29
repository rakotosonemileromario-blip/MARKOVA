import { timingSafeEqual } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isValidTimezone, DEFAULT_TZ } from "./timezone";

// Tâches planifiées (vercel.json → crons) : Vercel appelle la route avec
// « Authorization: Bearer <CRON_SECRET> ». Aucun utilisateur connecté.

export function cronAuthorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  const got = req.headers.get("authorization") ?? "";
  const want = `Bearer ${secret}`;
  return Boolean(secret) && got.length === want.length && timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

/** Utilisateurs à traiter : ceux qui ont une connexion ou une règle de surveillance, avec leur fuseau et leurs réglages. */
export async function cronUsers(admin: SupabaseClient) {
  const [integ, rules, settings] = await Promise.all([
    admin.from("integrations").select("user_id").in("provider", ["google", "meta"]),
    admin.from("watch_rules").select("user_id").eq("active", true),
    admin.from("user_settings").select("user_id, timezone, weekly_report"),
  ]);
  const ids = new Set([...(integ.data ?? []), ...(rules.data ?? [])].map((r) => r.user_id as string));
  const byUser = new Map((settings.data ?? []).map((s) => [s.user_id as string, s]));
  return [...ids].map((id) => {
    const s = byUser.get(id);
    return { id, timezone: isValidTimezone(s?.timezone) ? (s!.timezone as string) : DEFAULT_TZ, weeklyReport: s?.weekly_report ?? true };
  });
}
