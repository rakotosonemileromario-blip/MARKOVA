import { requireUser } from "@/lib/supabase/server";
import { getMetaApp, metaLongLived } from "@/lib/meta";
import { saveMetaConnection } from "@/lib/meta-store";

/**
 * POST { token } — connexion par jeton collé :
 * jeton d'utilisateur système (Business Manager, sans expiration) ou jeton utilisateur (converti en 60 jours si possible).
 */
export async function POST(req: Request) {
  const auth = await requireUser();
  if (!auth) return Response.json({ error: "Non authentifié" }, { status: 401 });
  const { token } = (await req.json().catch(() => ({}))) as { token?: string };
  const raw = token?.trim();
  if (!raw || raw.length < 30) return Response.json({ error: "Jeton invalide" }, { status: 400 });

  try {
    let final = raw;
    let expiresAt: string | null = null;
    // Un jeton utilisateur court est prolongé ; un jeton d'utilisateur système reste tel quel (sans expiration).
    const app = await getMetaApp(auth.supabase);
    if (app) {
      try {
        const long = await metaLongLived(raw, app);
        final = long.token;
        expiresAt = long.expiresAt;
      } catch {
        // jeton système ou appli non configurée : on garde le jeton fourni
      }
    }
    const name = await saveMetaConnection(auth.supabase, auth.user.id, final, expiresAt);
    return Response.json({ ok: true, name });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 422 });
  }
}
