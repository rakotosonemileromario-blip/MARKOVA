import { requireUser } from "@/lib/supabase/server";
import { detectKind, extractContent } from "@/lib/files";
import { cookies } from "next/headers";
import { PROJECT_COOKIE } from "@/lib/projects";

export const maxDuration = 60;

type Body = { path?: string; name?: string; mime?: string; size?: number };

/**
 * Le navigateur envoie le fichier directement dans Supabase Storage
 * (pas de limite de taille Vercel), puis appelle cette route pour l'enregistrer
 * et en extraire le contenu.
 */
export async function POST(req: Request) {
  const auth = await requireUser();
  if (!auth) return Response.json({ error: "Non authentifié" }, { status: 401 });
  const { supabase, user } = auth;

  const { path, name, mime = "application/octet-stream", size = 0 } = (await req.json()) as Body;
  if (!path || !name || !path.startsWith(`${user.id}/`)) {
    return Response.json({ error: "Chemin invalide" }, { status: 400 });
  }

  const kind = detectKind(name, mime);
  const project_id = (await cookies()).get(PROJECT_COOKIE)?.value || null;
  const { data: row, error } = await supabase
    .from("files")
    .insert({ name, storage_path: path, mime_type: mime, size_bytes: size, kind, project_id })
    .select("id")
    .single();
  if (error || !row) return Response.json({ error: error?.message ?? "Enregistrement impossible" }, { status: 500 });

  try {
    const { data: blob, error: dlError } = await supabase.storage.from("files").download(path);
    if (dlError || !blob) throw new Error(dlError?.message ?? "Téléchargement impossible");
    const result = await extractContent(name, kind, new Uint8Array(await blob.arrayBuffer()));
    await supabase
      .from("files")
      .update({ extracted_text: result.text, kpi_summary: result.kpi, status: "pret", error: result.note ?? null })
      .eq("id", row.id);
    return Response.json({ id: row.id, status: "pret", kpi: Boolean(result.kpi), note: result.note });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabase.from("files").update({ status: "erreur", error: message }).eq("id", row.id);
    return Response.json({ id: row.id, status: "erreur", error: message }, { status: 422 });
  }
}
