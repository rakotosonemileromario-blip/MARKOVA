import { requireUser } from "@/lib/supabase/server";
import { encrypt } from "@/lib/crypto";
import { verifyMetaApp } from "@/lib/meta";

/**
 * POST { appId, appSecret, configId? } — enregistre l'app Meta saisie dans MARKOVA
 * (vérifiée auprès de Meta, clé secrète chiffrée). Évite d'éditer .env.local.
 */
export async function POST(req: Request) {
  const auth = await requireUser();
  if (!auth) return Response.json({ error: "Non authentifié" }, { status: 401 });
  if (!process.env.TOKEN_ENCRYPTION_KEY) return Response.json({ error: "TOKEN_ENCRYPTION_KEY manquante sur le serveur." }, { status: 500 });

  const body = (await req.json().catch(() => ({}))) as { appId?: string; appSecret?: string; configId?: string };
  const appId = body.appId?.trim() ?? "";
  const appSecret = body.appSecret?.trim() ?? "";
  const configId = body.configId?.trim() || undefined;
  if (!/^\d{5,}$/.test(appId)) return Response.json({ error: "L'ID de l'app est un nombre (Paramètres de l'app → Général)." }, { status: 400 });
  if (appSecret.length < 16) return Response.json({ error: "Clé secrète invalide." }, { status: 400 });
  if (configId && !/^\d{5,}$/.test(configId)) return Response.json({ error: "L'ID de configuration est un nombre." }, { status: 400 });

  try {
    await verifyMetaApp({ id: appId, secret: appSecret });
  } catch {
    return Response.json({ error: "Meta refuse cet ID d'app / cette clé secrète. Vérifie-les dans Paramètres de l'app → Général." }, { status: 422 });
  }

  await auth.supabase.from("integrations").delete().eq("provider", "meta_app");
  const { error } = await auth.supabase.from("integrations").insert({
    user_id: auth.user.id,
    provider: "meta_app",
    client_slot: "1",
    account_email: appId,
    refresh_token_enc: encrypt(JSON.stringify({ secret: appSecret, configId })),
  });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}

/** DELETE — oublie l'app Meta enregistrée. */
export async function DELETE() {
  const auth = await requireUser();
  if (!auth) return Response.json({ error: "Non authentifié" }, { status: 401 });
  await auth.supabase.from("integrations").delete().eq("provider", "meta_app");
  return Response.json({ ok: true });
}
