import type { SupabaseClient } from "@supabase/supabase-js";
import { encrypt } from "./crypto";
import { META_SCOPES, metaMe } from "./meta";

/** Enregistre (ou remplace) la connexion Meta de l'utilisateur, jeton chiffré. */
export async function saveMetaConnection(supabase: SupabaseClient, userId: string, token: string, expiresAt: string | null) {
  const me = await metaMe(token);
  await supabase.from("integrations").delete().eq("provider", "meta");
  const { error } = await supabase.from("integrations").insert({
    user_id: userId,
    provider: "meta",
    client_slot: "1",
    account_email: me.name || me.id,
    refresh_token_enc: encrypt(token),
    scopes: META_SCOPES,
    expires_at: expiresAt,
  });
  if (error) throw new Error(error.message);
  return me.name;
}
