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

/** Décalage (ms) du fuseau par rapport à UTC à un instant donné. */
function offsetMs(tz: string, at: Date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(at)
      .map((x) => [x.type, x.value]),
  );
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(at.getTime() / 1000) * 1000;
}

/** « 2026-09-29T18:30 » exprimé dans le fuseau tz → instant UTC. */
export function localToUtc(local: string, tz: string): Date | null {
  const m = local.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (!m) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const first = guess - offsetMs(tz, new Date(guess));
  return new Date(guess - offsetMs(tz, new Date(first))); // 2e passe : changements d'heure
}

/** Date / heure lisible dans le fuseau. */
export const formatLocal = (d: Date | string, tz: string) =>
  new Date(d).toLocaleString("fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: tz });

/** Fuseau de l'appareil (cookie), sinon celui mémorisé, sinon Europe/Paris. */
export async function resolveTimezone(supabase: SupabaseClient, cookieTz?: string | null, userId?: string): Promise<string> {
  if (isValidTimezone(cookieTz)) return cookieTz;
  const q = supabase.from("user_settings").select("timezone");
  const { data } = await (userId ? q.eq("user_id", userId) : q).limit(1).maybeSingle();
  return isValidTimezone(data?.timezone) ? data.timezone : DEFAULT_TZ;
}
