import { createClient } from "@supabase/supabase-js";

// Client « service » : utilisé par les tâches planifiées (surveillance, rapport hebdo, veille) et la gestion
// de l'équipe. Il ignore la sécurité RLS : chaque requête faite avec lui doit filtrer explicitement par user_id.

/**
 * Valeur d'une variable d'environnement « secrète », réduite à sa première ligne non vide :
 * une clé collée plusieurs fois (ou avec un retour à la ligne) dans Vercel reste utilisable.
 */
export function secretEnv(name: string) {
  return (process.env[name] ?? "").split(/[\r\n]+/).map((l) => l.trim()).find(Boolean) ?? "";
}

const serviceKey = () => secretEnv("SUPABASE_SERVICE_ROLE_KEY");

export const adminConfigured = () => Boolean(serviceKey() && process.env.NEXT_PUBLIC_SUPABASE_URL);

export function createAdminClient() {
  if (!adminConfigured()) throw new Error("SUPABASE_SERVICE_ROLE_KEY manquant : les tâches planifiées ne peuvent pas lire les données.");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
