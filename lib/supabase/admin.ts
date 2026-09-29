import { createClient } from "@supabase/supabase-js";

// Client « service » : utilisé UNIQUEMENT par les tâches planifiées (surveillance, rapport hebdo),
// qui tournent sans utilisateur connecté. Il ignore la sécurité RLS : chaque requête faite avec lui
// doit filtrer explicitement par user_id.

export const adminConfigured = () => Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL);

export function createAdminClient() {
  if (!adminConfigured()) throw new Error("SUPABASE_SERVICE_ROLE_KEY manquant : les tâches planifiées ne peuvent pas lire les données.");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
