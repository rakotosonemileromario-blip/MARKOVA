import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import { encryptToken, exchangeCode, fetchTimezone, googleClient } from "@/lib/google";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const origin = url.origin;
  const back = (q: string) => {
    const res = NextResponse.redirect(`${origin}/connexions?${q}`);
    res.cookies.delete("g_oauth_state");
    return res;
  };

  const auth = await requireUser();
  if (!auth) return NextResponse.redirect(`${origin}/login`);

  if (url.searchParams.get("error")) return back("erreur=refus");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state || state !== req.cookies.get("g_oauth_state")?.value) return back("erreur=etat");

  const client = googleClient(state.split(".")[0]);
  if (!client) return back("erreur=config");

  try {
    const tokens = await exchangeCode(code, origin, client);
    if (!tokens.refresh_token) return back("erreur=refresh");

    let email: string | null = null;
    if (tokens.id_token) {
      const payload = JSON.parse(Buffer.from(tokens.id_token.split(".")[1], "base64url").toString("utf8"));
      email = payload.email ?? null;
    }
    if (!email) return back("erreur=email");
    const timezone = await fetchTimezone(tokens.access_token);

    const { error } = await auth.supabase.from("integrations").upsert(
      {
        user_id: auth.user.id,
        provider: "google",
        client_slot: client.slot,
        account_email: email,
        refresh_token_enc: encryptToken(tokens.refresh_token),
        scopes: (tokens.scope ?? "").split(" ").filter(Boolean),
        timezone,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,provider,account_email" },
    );
    if (error) throw new Error(error.message);
    return back(`ok=${encodeURIComponent(email)}`);
  } catch (err) {
    return back(`erreur=${encodeURIComponent(err instanceof Error ? err.message : String(err))}`);
  }
}
