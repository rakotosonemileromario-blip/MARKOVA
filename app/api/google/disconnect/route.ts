import { requireUser } from "@/lib/supabase/server";
import { googleClient, revokeToken } from "@/lib/google";
import { decrypt } from "@/lib/crypto";

/** POST { id } — révoque l'accès d'un compte Google et supprime la connexion. */
export async function POST(req: Request) {
  const auth = await requireUser();
  if (!auth) return Response.json({ error: "Non authentifié" }, { status: 401 });
  const { id } = (await req.json().catch(() => ({}))) as { id?: string };
  if (!id) return Response.json({ error: "id manquant" }, { status: 400 });

  const { data } = await auth.supabase
    .from("integrations")
    .select("id, client_slot, refresh_token_enc")
    .eq("id", id)
    .maybeSingle();
  if (data) {
    try {
      if (googleClient(data.client_slot)) await revokeToken(decrypt(data.refresh_token_enc));
    } catch {
      // Jeton illisible : on supprime quand même la connexion.
    }
    await auth.supabase.from("integrations").delete().eq("id", data.id);
  }
  return Response.json({ ok: true });
}
