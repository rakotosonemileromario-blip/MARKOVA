import { requireUser } from "@/lib/supabase/server";
import { getMetaSession, META_VERSION } from "@/lib/meta";

/** POST — retire l'autorisation MARKOVA côté Meta (si possible) et supprime la connexion. */
export async function POST() {
  const auth = await requireUser();
  if (!auth) return Response.json({ error: "Non authentifié" }, { status: 401 });
  const s = await getMetaSession(auth.supabase);
  if (s) {
    await fetch(`https://graph.facebook.com/${META_VERSION()}/me/permissions?access_token=${encodeURIComponent(s.token)}`, { method: "DELETE" }).catch(() => {});
  }
  await auth.supabase.from("integrations").delete().eq("provider", "meta");
  return Response.json({ ok: true });
}
