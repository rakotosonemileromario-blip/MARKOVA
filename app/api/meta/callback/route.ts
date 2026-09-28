import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import { getMetaApp, metaExchangeCode } from "@/lib/meta";
import { saveMetaConnection } from "@/lib/meta-store";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const origin = url.origin;
  const back = (q: string) => {
    const res = NextResponse.redirect(`${origin}/connexions?${q}`);
    res.cookies.delete("meta_oauth_state");
    return res;
  };

  const auth = await requireUser();
  if (!auth) return NextResponse.redirect(`${origin}/login`);
  if (url.searchParams.get("error")) return back("erreur=refus");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state || state !== req.cookies.get("meta_oauth_state")?.value) return back("erreur=etat");

  try {
    const app = await getMetaApp(auth.supabase);
    if (!app) return back("erreur=meta_config");
    const { token, expiresAt } = await metaExchangeCode(code, origin, app);
    const name = await saveMetaConnection(auth.supabase, auth.user.id, token, expiresAt);
    return back(`ok=${encodeURIComponent(`Facebook (${name})`)}&meta=choisir`);
  } catch (err) {
    return back(`erreur=${encodeURIComponent(err instanceof Error ? err.message : String(err))}`);
  }
}
