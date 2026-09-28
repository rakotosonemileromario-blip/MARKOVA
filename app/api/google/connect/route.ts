import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import { authUrl, googleClient, googleClients, googleConfigured } from "@/lib/google";

/** GET /api/google/connect?client=1 — lance l'autorisation Google avec le client OAuth choisi. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = url.origin;
  if (!(await requireUser())) return NextResponse.redirect(`${origin}/login`);
  if (!googleConfigured()) return NextResponse.redirect(`${origin}/connexions?erreur=config`);

  const client = googleClient(url.searchParams.get("client") ?? googleClients()[0].slot);
  if (!client) return NextResponse.redirect(`${origin}/connexions?erreur=config`);

  const state = `${client.slot}.${randomBytes(24).toString("base64url")}`;
  const res = NextResponse.redirect(authUrl(origin, state, client));
  res.cookies.set("g_oauth_state", state, { httpOnly: true, secure: origin.startsWith("https"), sameSite: "lax", maxAge: 600, path: "/" });
  return res;
}
