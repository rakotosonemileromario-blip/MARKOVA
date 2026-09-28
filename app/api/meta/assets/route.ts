import { requireUser } from "@/lib/supabase/server";
import { getMetaSession, listMetaAssets } from "@/lib/meta";

/** GET — pages Facebook (et leur Instagram) et comptes pub accessibles, avec la sélection actuelle. */
export async function GET() {
  const auth = await requireUser();
  if (!auth) return Response.json({ error: "Non authentifié" }, { status: 401 });
  const s = await getMetaSession(auth.supabase);
  if (!s) return Response.json({ error: "Facebook n'est pas connecté" }, { status: 404 });
  try {
    const assets = await listMetaAssets(s);
    return Response.json({ ...assets, selection: s.selection ?? {} });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}

/** POST { pages: string[], adAccounts: string[] } — pages et comptes que MARKOVA doit utiliser. */
export async function POST(req: Request) {
  const auth = await requireUser();
  if (!auth) return Response.json({ error: "Non authentifié" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { pages?: string[]; adAccounts?: string[] };
  const settings = {
    pages: Array.isArray(body.pages) ? body.pages.map(String) : [],
    adAccounts: Array.isArray(body.adAccounts) ? body.adAccounts.map(String) : [],
  };
  const { error } = await auth.supabase.from("integrations").update({ settings, updated_at: new Date().toISOString() }).eq("provider", "meta");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
