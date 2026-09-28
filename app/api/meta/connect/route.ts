import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import { getMetaApp, metaAuthUrl } from "@/lib/meta";

/** GET /api/meta/connect — ouvre la fenêtre « Continuer avec Facebook » (choix des pages, Instagram, comptes pub). */
export async function GET(req: Request) {
  const origin = new URL(req.url).origin;
  const auth = await requireUser();
  if (!auth) return NextResponse.redirect(`${origin}/login`);
  const app = await getMetaApp(auth.supabase);
  if (!app) return NextResponse.redirect(`${origin}/connexions?erreur=meta_config`);

  const state = randomBytes(24).toString("base64url");
  const res = NextResponse.redirect(metaAuthUrl(origin, state, app));
  res.cookies.set("meta_oauth_state", state, { httpOnly: true, secure: origin.startsWith("https"), sameSite: "lax", maxAge: 600, path: "/" });
  return res;
}
