import type { SupabaseClient } from "@supabase/supabase-js";

// Fuseau horaire : celui de l'appareil utilisé (PC ou téléphone), envoyé par le navigateur
// dans le cookie « markova_tz » et mémorisé dans user_settings pour les tâches planifiées.

export const TZ_COOKIE = "markova_tz";
export const DEFAULT_TZ = "Europe/Paris";

export function isValidTimezone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Fuseau de l'appareil (cookie), sinon celui mémorisé, sinon Europe/Paris. */
export async function resolveTimezone(supabase: SupabaseClient, cookieTz?: string | null, userId?: string): Promise<string> {
  if (isValidTimezone(cookieTz)) return cookieTz;
  const q = supabase.from("user_settings").select("timezone");
  const { data } = await (userId ? q.eq("user_id", userId) : q).limit(1).maybeSingle();
  return isValidTimezone(data?.timezone) ? data.timezone : DEFAULT_TZ;
}
