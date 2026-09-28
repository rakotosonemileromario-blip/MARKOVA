"use client";

import { createClient } from "@/lib/supabase/client";

export type UploadResult = { id: string; name: string; status: "pret" | "erreur"; error?: string };

/** Envoie un fichier dans Storage (dossier de l'utilisateur) puis déclenche l'extraction côté serveur. */
export async function uploadFile(file: File): Promise<UploadResult> {
  const supabase = createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Session expirée");

  const safeName = file.name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.\-]+/g, "_");
  const path = `${auth.user.id}/${crypto.randomUUID()}-${safeName}`;
  const { error } = await supabase.storage.from("files").upload(path, file, {
    contentType: file.type || undefined,
    upsert: false,
  });
  if (error) throw new Error(error.message);

  const res = await fetch("/api/files/process", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, name: file.name, mime: file.type || "application/octet-stream", size: file.size }),
  });
  const json = await res.json();
  if (!json.id) throw new Error(json.error ?? "Traitement impossible");
  return { id: json.id, name: file.name, status: json.status, error: json.error };
}

export const ACCEPT = ".pdf,.docx,.xlsx,.xlsm,.csv,.tsv,.txt,.md,.json,.png,.jpg,.jpeg,.webp,.gif";
