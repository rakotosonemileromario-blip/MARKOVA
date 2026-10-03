import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Retour des liens envoyés par email (mot de passe oublié) : ouvre la session puis va à « next ». */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next")?.startsWith("/") ? url.searchParams.get("next")! : "/";
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
  }
  return NextResponse.redirect(new URL("/login?lien=expire", url.origin));
}
