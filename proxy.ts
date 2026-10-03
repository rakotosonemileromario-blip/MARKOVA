import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Rafraîchit la session Supabase et redirige vers /login si non connecté.
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet) => {
          toSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  const { data } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;
  // Pages publiques : connexion + pages légales exigées par Meta / Google.
  // /api/cron : tâches planifiées, protégées par CRON_SECRET (pas de session). /sw.js : service worker des notifications.
  const isPublic =
    path.startsWith("/login") ||
    path.startsWith("/auth/") || // retour des liens email (mot de passe oublié)
    path.startsWith("/confidentialite") ||
    path.startsWith("/suppression-donnees") ||
    path.startsWith("/api/cron/") ||
    path.startsWith("/.well-known/") || // preuve que l'APK Android appartient au site (plein écran)
    path === "/manifest.webmanifest" ||
    path === "/sw.js";

  if (!data.user && !isPublic) {
    if (path.startsWith("/api/")) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  if (data.user && path.startsWith("/login")) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|ico)$).*)"],
};
